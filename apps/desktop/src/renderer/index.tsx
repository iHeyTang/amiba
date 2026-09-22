import { preparePluginStartup } from "./plugin-startup";
import { setPlatform } from "@amiba/app-runtime/platform";
import { seedDocumentLanguage } from "@amiba/i18n";

import {
  installDshClientDevReload,
  installDshClientTransport,
} from "./dsh-client-transport";
import { createElectronAdapter } from "./platform/electron";
import { installEmbeddedPageHost } from "./embedded-page-host";
import "./styles/globals.css";
installEmbeddedPageHost();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root element missing");
const root: HTMLElement = rootElement;

function removeStartupScreen(): void {
  document.getElementById("amiba-startup")?.remove();
}

const ROOT_READY_EVENT = "amiba:dsh-root-ready";
let shellReady = false;
const pendingSessionIds: string[] = [];
let pendingOpenSettings = false;

function dispatchOpenSession(sessionId: string): void {
  window.dispatchEvent(
    new CustomEvent("amiba:open-session", { detail: { sessionId } }),
  );
}

window.amiba.onOpenSession(({ sessionId }) => {
  const target = sessionId.trim();
  if (!target) return;
  if (!shellReady) {
    pendingSessionIds.push(target);
    return;
  }
  dispatchOpenSession(target);
});

// The application menu's Settings… entry (⌘, / Ctrl+,) funnels into the
// same `open-settings` layout action every other settings entry path uses
// (see `useSettingsShell` in dsh-plugin-ui-shell), so the dialog opens on
// whichever section the hash last addressed.
function dispatchOpenSettings(): void {
  window.dispatchEvent(
    new CustomEvent("amiba:dsh-layout-action", {
      detail: { action: "open-settings" },
    }),
  );
}

window.amiba.onOpenSettings(() => {
  if (!shellReady) {
    pendingOpenSettings = true;
    return;
  }
  dispatchOpenSettings();
});

function waitForAmibaRoot(timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      shellReady = true;
      window.clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener(ROOT_READY_EVENT, finish);
      // The shell is mounted, but the startup screen stays up: main now warms
      // the surfaces the user can reach (the pet window, Quick-Ask) and calls
      // back when they are ready, so the UI is never revealed with a cold path
      // behind it. `waitForReveal` consumes that call.
      window.amiba.shell.notifyReady();
      window.queueMicrotask(() => {
        for (const sessionId of pendingSessionIds.splice(0)) {
          dispatchOpenSession(sessionId);
        }
        if (pendingOpenSettings) {
          pendingOpenSettings = false;
          dispatchOpenSettings();
        }
      });
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-amiba-product-shell]")) finish();
    });
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener(ROOT_READY_EVENT, finish, { once: true });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      window.removeEventListener(ROOT_READY_EVENT, finish);
      reject(
        new Error("DSH UI Shell did not publish the Amiba product shell."),
      );
    }, timeoutMs);
    // A fast shell can mount before this waiter is installed. Run the same
    // cleanup and pending-navigation drain for both arrival orders.
    if (document.querySelector("[data-amiba-product-shell]")) finish();
  });
}

/**
 * Wait for main's "everything is warm" signal. Bounded: a warm-up that hangs
 * (or a main process that never answers) must still let the user in, and this
 * bound sits above main's own warm-up timeout so the normal path always wins.
 */
function waitForReveal(timeoutMs = 12_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: number | undefined;
    let unsubscribe: () => void = () => {};
    // `onReveal` can call back synchronously (the signal may already have
    // arrived), so nothing it touches may be declared after it runs.
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    unsubscribe = window.amiba.shell.onReveal(finish);
    timer = window.setTimeout(finish, timeoutMs);
  });
}

void (async () => {
  let disposePluginStartup: (() => void) | undefined;
  try {
    disposePluginStartup = await preparePluginStartup();
    const boot = await window.amiba.dshClient.boot();
    installDshClientTransport(boot.baseUrl);
    // DSH client rebuild SSE + auto-reload is a development affordance. In
    // packaged builds the plugin bundles are frozen, so keeping the EventSource
    // open per renderer just holds a dead long-lived connection; the main
    // process tags packaged windows with `packaged=1` (see index.ts loadFile).
    if (new URLSearchParams(location.search).get("packaged") !== "1") {
      installDshClientDevReload();
    }
    // DSH Client plugins run under the app origin here, so `location.origin`
    // never reaches the managed runtime authority. Publish it as a DOM
    // attribute contract (read by dsh-plugin-messaging-core). This is the
    // only data-amiba-dsh-* attribute left — the former slot-marker family
    // was replaced by official renderSlot render props.
    document.documentElement.setAttribute(
      "data-amiba-dsh-base-url",
      boot.baseUrl,
    );
    // Windows are pure views: the platform adapter dispatches conversation
    // data, the hosted chat engine and shared state to the MAIN process.
    setPlatform(createElectronAdapter());
    // DSH Client plugins register before Amiba's React root mounts. Publish a
    // provisional locale first so their initial labels never inherit
    // index.html's fallback language and then become stuck in a slot snapshot
    // cache. It is the browser-derived value, the same derivation the official
    // locale plugin makes for its own provisional locale; the OFFICIAL service
    // replaces it once `amiba-ui-shell` installs it (see
    // `plugins/dsh-plugin-ui-shell/src/client/locale-bridge.ts`).
    seedDocumentLanguage();
    (
      globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }
    ).__DSH_BOOT__ = boot.graph;
    // The Web Shell's module entry consumes `window.__ModuleLoader__` and
    // throws "bootstrap facade is missing" without it. Since DSH 0.1.1 that
    // facade arrives as an inline head script rather than being installed by
    // the frontend bundle, and this renderer composes its own document, so it
    // has to execute those inline scripts itself — before the module entry.
    for (const [index, code] of boot.shell.bootstrap.entries()) {
      const marker = `bootstrap-${index}`;
      if (document.querySelector(`script[data-dsh-shell="${marker}"]`)) continue;
      const script = document.createElement("script");
      script.dataset.dshShell = marker;
      script.textContent = code;
      document.head.append(script);
    }
    // The plugin-bundle preloads (classic head scripts). Each one calls the
    // facade's `load(...)`; `create()` inside the module entry refuses to run
    // for a graph entry nothing preloaded, so these must finish first, in
    // document order — exactly what a browser walking the real head does.
    for (const src of boot.shell.preload) {
      if (document.querySelector(`script[data-dsh-shell=${JSON.stringify(src)}]`))
        continue;
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.dataset.dshShell = src;
        script.addEventListener("load", () => resolve(), { once: true });
        script.addEventListener(
          "error",
          () => reject(new Error(`Failed to load DSH preload: ${src}`)),
          { once: true },
        );
        document.head.append(script);
      });
    }
    for (const href of boot.shell.styles) {
      if (
        document.querySelector(`link[data-dsh-shell=${JSON.stringify(href)}]`)
      )
        continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.dshShell = href;
      document.head.append(link);
    }
    for (const src of boot.shell.scripts) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.type = "module";
        script.src = src;
        script.dataset.dshShell = src;
        script.addEventListener("load", () => resolve(), { once: true });
        script.addEventListener(
          "error",
          () => reject(new Error(`Failed to load DSH Web Shell: ${src}`)),
          { once: true },
        );
        document.head.append(script);
      });
    }
    await waitForAmibaRoot();
    // The shell is mounted, but nothing is revealed until main reports that the
    // surfaces behind it are warm — the startup screen is the only place where
    // waiting is honest.
    await waitForReveal();
    await window.amiba.pluginStartup.ready();
    disposePluginStartup?.();
    removeStartupScreen();
  } catch (error) {
    // Main is replacing the cancelled boot and will reload this window. Keep
    // the quiet startup surface instead of flashing the old process's logs.
    if (String(error).includes("Startup replaced by safe mode")) return;
    console.error("[renderer] DSH Client Web Shell boot failed:", error);
    disposePluginStartup?.();
    removeStartupScreen();
    root.replaceChildren();
    const failure = document.createElement("pre");
    failure.className = "p-6 text-sm text-destructive whitespace-pre-wrap";
    failure.textContent =
      error instanceof Error ? error.message : String(error);
    root.append(failure);
    const recover = document.createElement("button");
    recover.textContent = navigator.language.startsWith("zh") ? "安全启动" : "Safe start";
    recover.className = "m-6 text-sm underline";
    recover.onclick = () => { void window.amiba.pluginStartup.choose("safe").then(() => window.location.reload()); };
    root.append(recover);
  }
})();
