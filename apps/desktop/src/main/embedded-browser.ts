import http from "node:http";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type BrowserWindow,
  ipcMain,
  webContents,
  type InputEvent as ElectronInputEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import type { DshNativeOperation } from "./dsh-native-gateway";

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
  | { action: "stop" };

interface ConsoleEntry {
  level: number;
  message: string;
  line: number;
  source: string;
  timestamp: number;
}

interface BrowserTabEntry {
  key: string;
  tabId: string;
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
  private readonly tabs = new Map<string, BrowserTabEntry>();
  private readonly registrationWaiters = new Set<
    (entry: BrowserTabEntry) => void
  >();
  private activeKey: string | null = null;
  private ipcRegistered = false;
  private hostWindowResolver: (() => BrowserWindow | null) | null = null;

  /**
   * Name the one window whose renderer mounts the workbench.
   *
   * Quick-Ask and the notifier also report `getType() === "window"`, so
   * resolving the create-tab target by "focused window, else first window"
   * could address a renderer with no `embedded-browser:create-tab` listener —
   * which surfaces as a 5s timeout instead of a browser tab.
   */
  setHostWindowResolver(resolve: () => BrowserWindow | null): void {
    this.hostWindowResolver = resolve;
  }

  private hostWindow(): BrowserWindow | null {
    const designated = this.hostWindowResolver?.() ?? null;
    return designated && !designated.isDestroyed() ? designated : null;
  }

  private key(ownerId: number, tabId: string): string {
    return `${ownerId}:${tabId}`;
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
    const entry = this.tabs.get(this.key(owner.id, tabId));
    if (!entry || entry.contents.isDestroyed()) {
      throw new Error("The embedded browser tab is no longer available");
    }
    return entry;
  }

  private activeEntry(): BrowserTabEntry {
    const entry = this.activeKey ? this.tabs.get(this.activeKey) : undefined;
    if (!entry || entry.contents.isDestroyed()) {
      throw new Error("No Amiba browser tab is available in the workbench.");
    }
    return entry;
  }

  private async ensureActiveEntry(): Promise<BrowserTabEntry> {
    try {
      return this.activeEntry();
    } catch {
      const owner = this.hostWindow();
      if (!owner || owner.isDestroyed()) {
        throw new Error(
          "No Amiba window is available for the built-in browser.",
        );
      }
      return await new Promise<BrowserTabEntry>((resolve, reject) => {
        let settled = false;
        const finish = (entry?: BrowserTabEntry, error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.registrationWaiters.delete(onRegistered);
          if (entry) resolve(entry);
          else reject(error);
        };
        const onRegistered = (entry: BrowserTabEntry) => finish(entry);
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
        this.registrationWaiters.add(onRegistered);
        owner.webContents.send("embedded-browser:create-tab");
      });
    }
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
    if (!entry.owner.isDestroyed()) entry.owner.send(channel, payload);
  }

  private async ensureVisible(entry: BrowserTabEntry): Promise<void> {
    this.send(entry, "embedded-browser:focus", { tabId: entry.tabId });
    // Give React one frame plus the pane transition's initial layout pass so
    // capturePage and coordinate-based browser actions see a real viewport.
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  private async withAgentActivity<T>(
    action: string,
    task: (entry: BrowserTabEntry) => Promise<T>,
  ): Promise<T> {
    const entry = await this.ensureActiveEntry();
    await this.ensureVisible(entry);
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

  registerIpc(): void {
    if (this.ipcRegistered) return;
    this.ipcRegistered = true;

    ipcMain.handle(
      "embedded-browser:register-tab",
      (
        event,
        input: { tabId: string; webContentsId: number; active?: boolean },
      ) => this.registerTab(event, input),
    );
    ipcMain.handle("embedded-browser:unregister-tab", (event, tabId: string) =>
      this.unregisterTab(event.sender, tabId),
    );
    ipcMain.handle("embedded-browser:set-active-tab", (event, tabId: string) =>
      this.setActiveTab(event.sender, tabId),
    );
    ipcMain.handle(
      "embedded-browser:command",
      (event, tabId: string, command: BrowserCommand) =>
        this.runManualCommand(event.sender, tabId, command),
    );
    ipcMain.handle("embedded-browser:detect-dev-servers", () =>
      detectDevServers(),
    );
  }

  private registerTab(
    event: IpcMainInvokeEvent,
    input: { tabId: string; webContentsId: number; active?: boolean },
  ): BrowserPageState {
    const tabId = this.validateTabId(input?.tabId);
    if (!Number.isInteger(input?.webContentsId)) {
      throw new Error("A valid WebContents id is required");
    }
    const guest = webContents.fromId(input.webContentsId);
    if (
      !guest ||
      guest.isDestroyed() ||
      guest.id === event.sender.id ||
      guest.getType() !== "webview" ||
      guest.hostWebContents?.id !== event.sender.id
    ) {
      throw new Error("Only an attached Amiba browser WebView can register");
    }

    const key = this.key(event.sender.id, tabId);
    const existing = this.tabs.get(key);
    if (existing?.contents.id === guest.id) {
      if (input.active) this.activeKey = key;
      return this.pageState(existing);
    }

    const entry: BrowserTabEntry = {
      key,
      tabId,
      owner: event.sender,
      contents: guest,
      console: [],
    };
    this.tabs.set(key, entry);
    if (input.active || !this.activeKey) this.activeKey = key;
    for (const resolve of [...this.registrationWaiters]) resolve(entry);

    guest.setWindowOpenHandler(({ url }) => {
      void guest.loadURL(normalizeEmbeddedBrowserUrl(url));
      return { action: "deny" };
    });
    guest.on("console-message", (_event, level, message, line, sourceId) => {
      entry.console.push({
        level,
        message,
        line,
        source: sourceId,
        timestamp: Date.now(),
      });
      if (entry.console.length > MAX_CONSOLE_MESSAGES) entry.console.shift();
    });
    guest.once("destroyed", () => {
      this.tabs.delete(key);
      if (this.activeKey === key) {
        this.activeKey =
          [...this.tabs.values()].find(
            (candidate) => !candidate.contents.isDestroyed(),
          )?.key ?? null;
      }
    });
    return this.pageState(entry);
  }

  private unregisterTab(owner: WebContents, tabIdValue: unknown): void {
    const tabId = this.validateTabId(tabIdValue);
    const key = this.key(owner.id, tabId);
    this.tabs.delete(key);
    if (this.activeKey === key) {
      this.activeKey =
        [...this.tabs.values()].find((entry) => !entry.contents.isDestroyed())
          ?.key ?? null;
    }
  }

  private setActiveTab(
    owner: WebContents,
    tabIdValue: unknown,
  ): BrowserPageState {
    const entry = this.entryFor(owner, tabIdValue);
    this.activeKey = entry.key;
    return this.pageState(entry);
  }

  private async runManualCommand(
    owner: WebContents,
    tabIdValue: unknown,
    command: BrowserCommand,
  ): Promise<BrowserPageState> {
    const entry = this.entryFor(owner, tabIdValue);
    this.activeKey = entry.key;
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
    } else if (command.action === "stop") {
      entry.contents.stop();
    }
    return this.pageState(entry);
  }

  platformOperations(): readonly DshNativeOperation[] {
    return [
      {
        name: "amiba_browser_open",
        call: (args) =>
          this.withAgentActivity("navigate", async (entry) => {
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
        call: () =>
          this.withAgentActivity("snapshot", async (entry) => {
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
        call: (args) =>
          this.withAgentActivity("click", async (entry) => {
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
        call: (args) =>
          this.withAgentActivity("type", async (entry) => {
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
        call: (args) =>
          this.withAgentActivity("press", async (entry) => {
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
        call: (args) =>
          this.withAgentActivity("scroll", async (entry) => {
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
        call: () =>
          this.withAgentActivity("screenshot", async (entry) => {
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
        call: (args) =>
          this.withAgentActivity("console", async (entry) => {
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

export const embeddedBrowserController = new EmbeddedBrowserController();
