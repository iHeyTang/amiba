import { DshApiClient } from "@amiba/app-runtime/dsh-client";
import { setPlatform } from "@amiba/app-runtime/platform";
import { loadLanguagePreference, resolveLanguage } from "@amiba/i18n";

import { installDshClientTransport } from "./dsh-client-transport";
import { createElectronAdapter } from "./platform/electron";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root element missing");
const root: HTMLElement = rootElement;

const ROOT_READY_EVENT = "amiba:dsh-root-ready";
let shellReady = false;
const pendingSessionIds: string[] = [];

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

function waitForAmibaRoot(timeoutMs = 30_000): Promise<void> {
  if (document.querySelector("[data-amiba-product-shell]")) {
    shellReady = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      shellReady = true;
      window.clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener(ROOT_READY_EVENT, finish);
      window.queueMicrotask(() => {
        for (const sessionId of pendingSessionIds.splice(0)) {
          dispatchOpenSession(sessionId);
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
  });
}

void (async () => {
  try {
    const boot = await window.amiba.dshClient.boot();
    installDshClientTransport(boot.baseUrl);
    // DSH Client plugins run under the app origin here, so `location.origin`
    // never reaches the managed runtime authority. Publish it through the
    // same DOM side-channel family as the other data-amiba-dsh-* contracts.
    document.documentElement.setAttribute(
      "data-amiba-dsh-base-url",
      boot.baseUrl,
    );
    const dshApiClient = new DshApiClient({ baseUrl: boot.baseUrl });
    setPlatform(createElectronAdapter(dshApiClient));
    // DSH Client plugins register before Amiba's React root mounts. Publish the
    // persisted locale first so their initial labels never inherit index.html's
    // fallback language and then become stuck in a slot snapshot cache.
    document.documentElement.lang = resolveLanguage(
      await loadLanguagePreference(),
    );
    (
      globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }
    ).__DSH_BOOT__ = boot.graph;
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
  } catch (error) {
    console.error("[renderer] DSH Client Web Shell boot failed:", error);
    root.replaceChildren();
    const failure = document.createElement("pre");
    failure.className = "p-6 text-sm text-destructive whitespace-pre-wrap";
    failure.textContent =
      error instanceof Error ? error.message : String(error);
    root.append(failure);
  }
})();
