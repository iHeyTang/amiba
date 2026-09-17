import http from "node:http";
import { CookieImporter } from "./cookie-import.js";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  shell,
  session,
  webContents,
  type InputEvent as ElectronInputEvent,
  type WebContents,
} from "electron";
import type {
  DesktopExtension,
  DesktopExtensionContext,
} from "@amiba/extension-sdk";
type DshNativeCallContext = { sessionId?: string };
interface DshNativeOperation {
  name: string;
  call(
    args: Record<string, unknown>,
    context: DshNativeCallContext,
  ): unknown | Promise<unknown>;
}
import {
  BrowserTabIndex,
  browserTabKey,
  type BrowserTabRecord,
} from "./embedded-browser-tabs.js";

const MAX_TAB_ID_LENGTH = 160;
const MAX_SNAPSHOT_CHARS = 18_000;
const MAX_CONSOLE_MESSAGES = 200;
const DEV_SERVER_PORTS = [
  3000, 3001, 4173, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8787,
];

type BrowserCommand =
  | { action: "navigate"; url: string }
  | { action: "back" }
  | { action: "forward" }
  | { action: "reload" }
  | { action: "hardReload" }
  | { action: "stop" }
  | { action: "capture" };

interface ConsoleEntry {
  level: number;
  message: string;
  line: number;
  source: string;
  timestamp: number;
}

interface BrowserTabEntry extends BrowserTabRecord {
  key: string;
  tabId: string;
  /** The chat session that owns this tab; absent for session-less tabs. */
  sessionId?: string;
  owner: WebContents;
  contents: WebContents;
  console: ConsoleEntry[];
}

interface BrowserPageState {
  tab_id: string;
  url: string;
  title: string;
  can_go_back: boolean;
  can_go_forward: boolean;
  loading: boolean;
  /** Present for a `capture` command: a base64 PNG of the rendered page. */
  screenshot?: string;
}

function objectArguments(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function textResult<T extends object>(message: string, value: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${message}\n${JSON.stringify(value, null, 2)}`,
      },
    ],
    structuredContent: value,
  };
}

export function normalizeEmbeddedBrowserUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "about:blank";
  if (isAbsolute(value)) return pathToFileURL(value).toString();

  try {
    const parsed = new URL(value);
    if (["http:", "https:", "file:", "about:"].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    // Add a scheme or treat the input as a search below.
  }

  if (
    /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
      value,
    )
  ) {
    return `http://${value}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(value)) {
    return `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function probeLocalUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(450, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function detectDevServers(): Promise<
  Array<{ url: string; port: number }>
> {
  const results = await Promise.all(
    DEV_SERVER_PORTS.map(async (port) => {
      const url = `http://localhost:${port}`;
      return (await probeLocalUrl(url)) ? { url, port } : null;
    }),
  );
  return results.filter(
    (entry): entry is { url: string; port: number } => entry !== null,
  );
}

function snapshotScript(maxChars: number): string {
  return `(() => {
    const MAX_CHARS = ${Math.max(1_000, Math.min(maxChars, MAX_SNAPSHOT_CHARS))};
    const stateKey = "__amibaEmbeddedBrowserRefs";
    let state = globalThis[stateKey];
    if (!state || !(state.refs instanceof Map) || !(state.elements instanceof WeakMap)) {
      state = { next: 1, refs: new Map(), elements: new WeakMap() };
      Object.defineProperty(globalThis, stateKey, { value: state, configurable: true });
    }
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const selector = [
      "a[href]", "button", "input", "textarea", "select", "summary",
      "[contenteditable='true']", "[role='button']", "[role='link']",
      "[role='checkbox']", "[role='radio']", "[role='tab']", "[tabindex]"
    ].join(",");
    const elements = [...document.querySelectorAll(selector)].filter(visible).slice(0, 250);
    const interactive = elements.map((element) => {
      let ref = state.elements.get(element);
      if (!ref) {
        ref = "e" + state.next++;
        state.elements.set(element, ref);
        state.refs.set(ref, element);
      }
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role") || (tag === "a" ? "link" : tag);
      const name = (
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder") ||
        element.innerText ||
        element.value ||
        element.getAttribute("alt") ||
        ""
      ).replace(/\\s+/g, " ").trim().slice(0, 180);
      const details = [];
      if (element.disabled) details.push("disabled");
      if (element.checked === true) details.push("checked");
      if (element.value && tag !== "button") details.push("value=" + JSON.stringify(String(element.value).slice(0, 120)));
      return "- [ref=" + ref + "] " + role + (name ? " " + JSON.stringify(name) : "") + (details.length ? " (" + details.join(", ") + ")" : "");
    });
    const text = (document.body?.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
    const header = "URL: " + location.href + "\\nTitle: " + document.title;
    const sections = [header, interactive.length ? "Interactive elements:\\n" + interactive.join("\\n") : "Interactive elements: none", text ? "Page text:\\n" + text : ""];
    const snapshot = sections.filter(Boolean).join("\\n\\n");
    return {
      url: location.href,
      title: document.title,
      snapshot: snapshot.slice(0, MAX_CHARS),
      truncated: snapshot.length > MAX_CHARS,
      full_length: snapshot.length,
      interactive_count: interactive.length,
    };
  })()`;
}

function resolveElementScript(target: string, operation: string): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const state = globalThis.__amibaEmbeddedBrowserRefs;
    const normalized = target.replace(/^@/, "");
    let element = state?.refs?.get(normalized) || null;
    if (!element || !element.isConnected) {
      try { element = document.querySelector(target); } catch {}
    }
    if (!element) {
      const candidates = [...document.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link'],[contenteditable='true']")];
      const exact = candidates.find((candidate) => (candidate.innerText || candidate.getAttribute("aria-label") || "").trim() === target);
      element = exact || candidates.find((candidate) => (candidate.innerText || candidate.getAttribute("aria-label") || "").includes(target)) || null;
    }
    if (!element) return { ok: false, error: "Element not found: " + target };
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    ${operation}
  })()`;
}

class EmbeddedBrowserController {
  private readonly cookieImporter = new CookieImporter(
    session.fromPartition("persist:amiba-browser").cookies,
  );
  private readonly tabs = new BrowserTabIndex<BrowserTabEntry>();
  private readonly context: DesktopExtensionContext;
  private disposed = false;
  private readonly pending = new Set<(error: Error) => void>();
  private readonly cleanups = new Map<string, () => void>();
  /** Tab ids with an active frame stream (for the summary's live preview). */
  private readonly frameStreams = new Set<string>();
  constructor(context: DesktopExtensionContext) {
    this.context = context;
  }
  private hostWindow(): WebContents | null {
    const id = this.context.hostContentsId();
    return id === null ? null : (webContents.fromId(id) ?? null);
  }
  dispose(): void {
    this.disposed = true;
    this.cookieImporter.dispose();
    this.frameStreams.clear();
    for (const reject of [...this.pending])
      reject(new Error("Browser plugin unloaded"));
    for (const entry of [...this.tabs.values()]) {
      this.cleanups.get(entry.key)?.();
      this.cleanups.delete(entry.key);
      this.tabs.delete(entry.key);
      if (!entry.contents.isDestroyed()) entry.contents.close();
    }
  }
  private validateTabId(tabId: unknown): string {
    if (
      typeof tabId !== "string" ||
      !tabId.trim() ||
      tabId.length > MAX_TAB_ID_LENGTH
    ) {
      throw new Error("A valid browser tab id is required");
    }
    return tabId;
  }

  private entryFor(owner: WebContents, tabIdValue: unknown): BrowserTabEntry {
    const tabId = this.validateTabId(tabIdValue);
    const entry = this.tabs.get(browserTabKey(owner.id, tabId));
    if (!entry || entry.contents.isDestroyed()) {
      throw new Error("The embedded browser tab is no longer available");
    }
    return entry;
  }

  /**
   * The tab a call acts on.
   *
   * `sessionId` scopes the lookup to the session that made the call, so a
   * task running in the background gets its own tab instead of driving the
   * conversation on screen. A call with no session (the user clicking "open
   * browser") keeps the original global behaviour.
   */
  private async ensureActiveEntry(
    sessionId?: string,
  ): Promise<BrowserTabEntry> {
    if (this.disposed) throw new Error("Browser plugin unloaded");
    const existing = this.tabs.active(sessionId);
    if (existing) return existing;

    const owner = this.hostWindow();
    if (!owner || owner.isDestroyed()) {
      throw new Error("No Amiba window is available for the built-in browser.");
    }
    return await new Promise<BrowserTabEntry>((resolve, reject) => {
      let settled = false;
      const finish = (entry?: BrowserTabEntry, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stopWaiting();
        this.pending.delete(cancel);
        if (entry) resolve(entry);
        else reject(error);
      };
      const timer = setTimeout(
        () =>
          finish(
            undefined,
            new Error(
              "Amiba could not create a browser tab for the Agent in time.",
            ),
          ),
        5_000,
      );
      // The waiter is bucketed by session: a tab another session registers
      // while we wait is not ours to take.
      const stopWaiting = this.tabs.addRegistrationWaiter(sessionId, (entry) =>
        finish(entry),
      );
      const cancel = (error: Error) => finish(undefined, error);
      this.pending.add(cancel);
      this.context.emit(owner.id, "embedded-browser:create-tab", { sessionId });
    });
  }

  private pageState(entry: BrowserTabEntry): BrowserPageState {
    return {
      tab_id: entry.tabId,
      url: entry.contents.getURL(),
      title: entry.contents.getTitle(),
      can_go_back: entry.contents.navigationHistory.canGoBack(),
      can_go_forward: entry.contents.navigationHistory.canGoForward(),
      loading: entry.contents.isLoading(),
    };
  }

  private send(entry: BrowserTabEntry, channel: string, payload: unknown) {
    if (!this.disposed && !entry.owner.isDestroyed())
      this.context.emit(entry.owner.id, channel, payload);
  }

  private async ensureVisible(entry: BrowserTabEntry): Promise<void> {
    // The owning session travels with the focus so the renderer brings the
    // right workbench record forward — never the one currently on screen.
    this.send(entry, "embedded-browser:focus", {
      tabId: entry.tabId,
      sessionId: entry.sessionId,
    });
    // Give React one frame plus the pane transition's initial layout pass so
    // capturePage and coordinate-based browser actions see a real viewport.
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  private async withAgentActivity<T>(
    action: string,
    context: DshNativeCallContext,
    task: (entry: BrowserTabEntry) => Promise<T>,
  ): Promise<T> {
    const entry = await this.ensureActiveEntry(context.sessionId);
    await this.ensureVisible(entry);
    if (this.disposed) throw new Error("Browser plugin unloaded");
    this.send(entry, "embedded-browser:agent-activity", {
      action,
      running: true,
      tabId: entry.tabId,
    });
    try {
      return await task(entry);
    } finally {
      this.send(entry, "embedded-browser:agent-activity", {
        action,
        running: false,
        tabId: entry.tabId,
      });
    }
  }

  rendererCall(ownerId: number, method: string, args: unknown): unknown {
    if (this.disposed) throw new Error("Browser plugin unloaded");
    const owner = webContents.fromId(ownerId);
    if (!owner || owner.isDestroyed())
      throw new Error("Renderer is unavailable");
    const input = objectArguments(args);
    switch (method) {
      case "cookie-import:sources":
        return this.cookieImporter.sources();
      case "cookie-import:sites":
        return this.cookieImporter.sites(requiredString(input, "sourceId"));
      case "cookie-import:run":
        return this.cookieImporter.run(
          requiredString(input, "sourceId"),
          input.domains as string[],
          input.overwrite === true,
        );
      case "cookie-import:run-all":
        return this.cookieImporter.run(
          requiredString(input, "sourceId"),
          null,
          input.overwrite === true,
        );
      case "register-tab":
        return this.registerTab(owner, input as never);
      case "unregister-tab":
        return this.unregisterTab(owner, input.tabId);
      case "set-active-tab":
        return this.setActiveTab(owner, input.tabId);
      case "command":
        return this.runManualCommand(
          owner,
          input.tabId,
          input.command as BrowserCommand,
        );
      case "start-frame-stream":
        return this.startFrameStream(owner, input.tabId, input.width);
      case "stop-frame-stream":
        return this.stopFrameStream(owner, input.tabId);
      case "detect-dev-servers":
        return detectDevServers();
      case "open-external": {
        const url = requiredString(input, "url");
        if (!["https:", "http:", "file:"].includes(new URL(url).protocol))
          throw new Error("External browser URL must use HTTP(S) or file");
        return shell.openExternal(url);
      }
      default:
        throw new Error(`Unknown browser renderer operation: ${method}`);
    }
  }

  private registerTab(
    owner: WebContents,
    input: {
      tabId: string;
      webContentsId: number;
      active?: boolean;
      sessionId?: string;
    },
  ): BrowserPageState {
    const tabId = this.validateTabId(input?.tabId);
    if (!Number.isInteger(input?.webContentsId)) {
      throw new Error("A valid WebContents id is required");
    }
    const guest = webContents.fromId(input.webContentsId);
    if (
      !guest ||
      guest.isDestroyed() ||
      guest.id === owner.id ||
      guest.getType() !== "webview" ||
      guest.session !== session.fromPartition("persist:amiba-browser") ||
      guest.hostWebContents?.id !== owner.id
    ) {
      throw new Error("Only an attached Amiba browser WebView can register");
    }

    const sessionId =
      typeof input.sessionId === "string" && input.sessionId.trim()
        ? input.sessionId
        : undefined;
    const key = browserTabKey(owner.id, tabId);
    const existing = this.tabs.get(key);
    if (existing?.contents.id === guest.id) {
      if (input.active) this.tabs.activate(existing);
      return this.pageState(existing);
    }

    this.cleanups.get(key)?.();
    if (existing && !existing.contents.isDestroyed()) existing.contents.close();

    const entry: BrowserTabEntry = {
      key,
      tabId,
      sessionId,
      owner: owner,
      contents: guest,
      console: [],
    };
    this.tabs.add(entry, input.active === true);

    guest.setWindowOpenHandler(({ url }) => {
      void guest.loadURL(normalizeEmbeddedBrowserUrl(url));
      return { action: "deny" };
    });
    const onConsole = (
      _event: unknown,
      level: number,
      message: string,
      line: number,
      sourceId: string,
    ) => {
      entry.console.push({
        level,
        message,
        line,
        source: sourceId,
        timestamp: Date.now(),
      });
      if (entry.console.length > MAX_CONSOLE_MESSAGES) entry.console.shift();
    };
    const onDestroyed = () => {
      this.tabs.delete(key);
      this.cleanups.delete(key);
    };
    guest.on("console-message", onConsole);
    guest.once("destroyed", onDestroyed);
    this.cleanups.set(key, () => {
      guest.removeListener("console-message", onConsole);
      guest.removeListener("destroyed", onDestroyed);
    });
    return this.pageState(entry);
  }

  private unregisterTab(owner: WebContents, tabIdValue: unknown): void {
    const tabId = this.validateTabId(tabIdValue);
    const key = browserTabKey(owner.id, tabId);
    const entry = this.tabs.get(key);
    this.frameStreams.delete(tabId);
    this.cleanups.get(key)?.();
    this.cleanups.delete(key);
    this.tabs.delete(key);
    if (entry && !entry.contents.isDestroyed()) entry.contents.close();
  }

  private setActiveTab(
    owner: WebContents,
    tabIdValue: unknown,
  ): BrowserPageState {
    const entry = this.entryFor(owner, tabIdValue);
    this.tabs.activate(entry);
    return this.pageState(entry);
  }

  private async runManualCommand(
    owner: WebContents,
    tabIdValue: unknown,
    command: BrowserCommand,
  ): Promise<BrowserPageState> {
    const entry = this.entryFor(owner, tabIdValue);
    this.tabs.activate(entry);
    if (!command || typeof command !== "object") {
      throw new Error("A browser command is required");
    }
    if (command.action === "navigate") {
      await entry.contents.loadURL(normalizeEmbeddedBrowserUrl(command.url));
    } else if (
      command.action === "back" &&
      entry.contents.navigationHistory.canGoBack()
    ) {
      entry.contents.navigationHistory.goBack();
    } else if (
      command.action === "forward" &&
      entry.contents.navigationHistory.canGoForward()
    ) {
      entry.contents.navigationHistory.goForward();
    } else if (command.action === "reload") {
      entry.contents.reload();
    } else if (command.action === "hardReload") {
      entry.contents.reloadIgnoringCache();
    } else if (command.action === "stop") {
      entry.contents.stop();
    }
    const state = this.pageState(entry);
    if (command.action === "capture") {
      const image = await entry.contents.capturePage();
      state.screenshot = image.toPNG().toString("base64");
    }
    return state;
  }

  /** Stream the tab's rendered frames to the renderer (~10fps JPEG), for the summary's live preview. */
  private startFrameStream(
    owner: WebContents,
    tabIdValue: unknown,
    widthValue: unknown,
  ): void {
    const entry = this.entryFor(owner, tabIdValue);
    this.stopFrameStream(owner, tabIdValue);
    const width =
      typeof widthValue === "number" ? Math.max(96, Math.round(widthValue)) : 320;
    const FRAME_INTERVAL_MS = 100;
    let lastEmit = 0;
    // `onlyDirty: false` — a parked, already-loaded page does not repaint, so
    // a dirty-only subscription would never emit and the preview would stay
    // blank. Capture every frame and throttle to ~10fps below.
    entry.contents.beginFrameSubscription(false, (image) => {
      const now = Date.now();
      if (now - lastEmit < FRAME_INTERVAL_MS) return;
      lastEmit = now;
      try {
        const resized = image.resize({ width });
        this.send(entry, "embedded-browser:frame", {
          tabId: entry.tabId,
          data: resized.toJPEG(70).toString("base64"),
        });
      } catch {
        // Resize/encode failures are non-fatal for a preview.
      }
    });
    this.frameStreams.add(entry.tabId);
  }

  private stopFrameStream(owner: WebContents, tabIdValue: unknown): void {
    const entry = this.entryFor(owner, tabIdValue);
    if (!this.frameStreams.delete(entry.tabId)) return;
    if (!entry.contents.isDestroyed()) entry.contents.endFrameSubscription();
  }

  platformOperations(): readonly DshNativeOperation[] {
    return [
      {
        name: "amiba_browser_open",
        call: (args, context) =>
          this.withAgentActivity("navigate", context, async (entry) => {
            await entry.contents.loadURL(
              normalizeEmbeddedBrowserUrl(requiredString(args, "url")),
            );
            return textResult(
              "Visible browser navigation completed.",
              this.pageState(entry),
            );
          }),
      },
      {
        name: "amiba_browser_snapshot",
        call: (_args, context) =>
          this.withAgentActivity("snapshot", context, async (entry) => {
            const snapshot = objectArguments(
              await entry.contents.executeJavaScript(
                snapshotScript(MAX_SNAPSHOT_CHARS),
                true,
              ),
            );
            return textResult("Visible browser snapshot.", {
              ...this.pageState(entry),
              ...snapshot,
            });
          }),
      },
      {
        name: "amiba_browser_click",
        call: (args, context) =>
          this.withAgentActivity("click", context, async (entry) => {
            const target = requiredString(args, "target");
            const result = objectArguments(
              await entry.contents.executeJavaScript(
                resolveElementScript(
                  target,
                  "element.focus(); element.click(); return { ok: true };",
                ),
                true,
              ),
            );
            if (result.ok !== true) throw new Error(String(result.error));
            await new Promise((resolve) => setTimeout(resolve, 120));
            return textResult(
              "Visible browser click completed.",
              this.pageState(entry),
            );
          }),
      },
      {
        name: "amiba_browser_type",
        call: (args, context) =>
          this.withAgentActivity("type", context, async (entry) => {
            const target = requiredString(args, "target");
            const text = typeof args.text === "string" ? args.text : "";
            const operation = `
              element.focus();
              if (element.isContentEditable) {
                element.textContent = ${JSON.stringify(text)};
              } else {
                const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
                if (descriptor?.set) descriptor.set.call(element, ${JSON.stringify(text)});
                else element.value = ${JSON.stringify(text)};
              }
              element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(text)} }));
              element.dispatchEvent(new Event("change", { bubbles: true }));
              if (${args.submit === true}) element.form?.requestSubmit();
              return { ok: true };
            `;
            const result = objectArguments(
              await entry.contents.executeJavaScript(
                resolveElementScript(target, operation),
                true,
              ),
            );
            if (result.ok !== true) throw new Error(String(result.error));
            return textResult(
              "Visible browser input completed.",
              this.pageState(entry),
            );
          }),
      },
      {
        name: "amiba_browser_press",
        call: (args, context) =>
          this.withAgentActivity("press", context, async (entry) => {
            const raw = requiredString(args, "key");
            const parts = raw
              .split("+")
              .map((part) => part.trim())
              .filter(Boolean);
            const keyCode = parts.at(-1) ?? raw;
            type Modifier = NonNullable<
              ElectronInputEvent["modifiers"]
            >[number];
            const modifierAliases: Record<string, Modifier> = {
              alt: "alt",
              cmd: "command",
              command: "command",
              control: "control",
              ctrl: "control",
              meta: "meta",
              shift: "shift",
            };
            const modifiers = parts
              .slice(0, -1)
              .map((modifier) => modifierAliases[modifier.toLowerCase()])
              .filter(
                (modifier): modifier is Modifier => modifier !== undefined,
              );
            entry.contents.focus();
            entry.contents.sendInputEvent({
              type: "keyDown",
              keyCode,
              modifiers,
            });
            entry.contents.sendInputEvent({
              type: "keyUp",
              keyCode,
              modifiers,
            });
            return textResult(
              "Visible browser key press completed.",
              this.pageState(entry),
            );
          }),
      },
      {
        name: "amiba_browser_scroll",
        call: (args, context) =>
          this.withAgentActivity("scroll", context, async (entry) => {
            const direction = ["up", "down", "left", "right"].includes(
              String(args.direction),
            )
              ? String(args.direction)
              : "down";
            const amount = Math.max(
              1,
              Math.min(5_000, Number(args.amount) || 600),
            );
            const x =
              direction === "left"
                ? -amount
                : direction === "right"
                  ? amount
                  : 0;
            const y =
              direction === "up" ? -amount : direction === "down" ? amount : 0;
            await entry.contents.executeJavaScript(
              `window.scrollBy({ left: ${x}, top: ${y}, behavior: "instant" })`,
              true,
            );
            return textResult(
              "Visible browser scroll completed.",
              this.pageState(entry),
            );
          }),
      },
      {
        name: "amiba_browser_screenshot",
        call: (_args, context) =>
          this.withAgentActivity("screenshot", context, async (entry) => {
            const image = await entry.contents.capturePage();
            const state = this.pageState(entry);
            return {
              content: [
                {
                  type: "text",
                  text: `Visible browser screenshot: ${state.title || state.url}`,
                },
                {
                  type: "image",
                  data: image.toPNG().toString("base64"),
                  mimeType: "image/png",
                },
              ],
              structuredContent: state,
            };
          }),
      },
      {
        name: "amiba_browser_console",
        call: (args, context) =>
          this.withAgentActivity("console", context, async (entry) => {
            const messages = entry.console.slice(-100);
            if (args.clear === true) entry.console.length = 0;
            return textResult("Visible browser console messages.", {
              ...this.pageState(entry),
              messages,
            });
          }),
      },
    ];
  }
}

export function create(context: DesktopExtensionContext): DesktopExtension {
  const controller = new EmbeddedBrowserController(context);
  const operations = new Map(
    controller
      .platformOperations()
      .map((operation) => [operation.name, operation]),
  );
  return {
    partitions: ["persist:amiba-browser"],
    call(method, args, context) {
      const operation = operations.get(method);
      if (!operation) throw new Error(`Unknown browser operation: ${method}`);
      return operation.call(args, context);
    },
    rendererCall: (owner, method, args) =>
      controller.rendererCall(owner, method, args),
    dispose: () => controller.dispose(),
  };
}
