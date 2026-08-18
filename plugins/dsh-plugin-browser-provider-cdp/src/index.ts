import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type {
  BrowserOperation,
  BrowserProvider,
} from "@amiba/dsh-plugin-browser-core";

const SNAPSHOT_LIMIT = 18_000;
const CONSOLE_LIMIT = 200;

type JsonRecord = Record<string, unknown>;

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: JsonRecord;
  result?: JsonRecord;
  error?: { code?: number; message?: string };
}

interface PendingCall {
  resolve(value: JsonRecord): void;
  reject(error: Error): void;
}

export interface Config {
  endpoint?: string;
  allowRemote?: boolean;
  initialUrl?: string;
}

export const Config: z<Config> = z.object({
  endpoint: z.string().default(""),
  allowRemote: z.boolean().default(false),
  initialUrl: z.string().default("about:blank"),
});

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function requiredString(value: JsonRecord, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || !result.trim()) {
    throw new Error(`${key} is required`);
  }
  return result.trim();
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function validateEndpoint(value: string, allowRemote: boolean): URL {
  const url = new URL(value);
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("CDP endpoint must use HTTP(S) or WebSocket");
  }
  if (url.username || url.password) {
    throw new Error("CDP endpoint URL must not contain credentials");
  }
  if (!allowRemote && !isLoopback(url.hostname)) {
    throw new Error("Remote CDP endpoints require allowRemote=true");
  }
  return url;
}

async function browserWebSocketUrl(endpoint: URL): Promise<string> {
  if (endpoint.protocol === "ws:" || endpoint.protocol === "wss:") {
    return endpoint.toString();
  }
  const version = new URL("/json/version", endpoint);
  const response = await fetch(version, {
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`CDP discovery returned HTTP ${response.status}`);
  const body = record(await response.json());
  const url = body.webSocketDebuggerUrl;
  if (typeof url !== "string" || !url) {
    throw new Error("CDP discovery did not return webSocketDebuggerUrl");
  }
  return url;
}

class CdpConnection {
  private socket?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Set<(message: CdpMessage) => void>();

  async connect(url: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const socket = new WebSocket(url);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Unable to connect to the CDP browser endpoint"));
      };
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
    socket.addEventListener("message", (event) => {
      let message: CdpMessage;
      try {
        message = JSON.parse(String(event.data)) as CdpMessage;
      } catch {
        return;
      }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "CDP command failed"));
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP connection closed"));
      }
      this.pending.clear();
    });
  }

  onEvent(listener: (message: CdpMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(
    method: string,
    params: JsonRecord = {},
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<JsonRecord> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("CDP browser is not connected");
    }
    signal?.throwIfAborted();
    const id = this.nextId++;
    const result = new Promise<JsonRecord>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    if (!signal) return result;
    const aborted = new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return Promise.race([result, aborted]);
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}

function snapshotExpression(): string {
  return `(() => {
    const stateKey = "__amibaBrowserRefs";
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
    const selector = "a[href],button,input,textarea,select,summary,[contenteditable='true'],[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='tab'],[tabindex]";
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
      const name = (element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.innerText || element.value || "").replace(/\\s+/g, " ").trim().slice(0, 180);
      return "- [ref=" + ref + "] " + role + (name ? " " + JSON.stringify(name) : "");
    });
    const text = (document.body?.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
    const snapshot = ["URL: " + location.href + "\\nTitle: " + document.title, interactive.length ? "Interactive elements:\\n" + interactive.join("\\n") : "Interactive elements: none", text ? "Page text:\\n" + text : ""].filter(Boolean).join("\\n\\n");
    return { url: location.href, title: document.title, snapshot: snapshot.slice(0, ${SNAPSHOT_LIMIT}), truncated: snapshot.length > ${SNAPSHOT_LIMIT}, full_length: snapshot.length, interactive_count: interactive.length };
  })()`;
}

function elementExpression(target: string, operation: string): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const normalized = target.replace(/^@/, "");
    let element = globalThis.__amibaBrowserRefs?.refs?.get(normalized) || null;
    if (!element || !element.isConnected) { try { element = document.querySelector(target); } catch {} }
    if (!element) {
      const candidates = [...document.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link'],[contenteditable='true']")];
      element = candidates.find((candidate) => (candidate.innerText || candidate.getAttribute("aria-label") || "").trim() === target) || candidates.find((candidate) => (candidate.innerText || candidate.getAttribute("aria-label") || "").includes(target)) || null;
    }
    if (!element) return { ok: false, error: "Element not found: " + target };
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    ${operation}
  })()`;
}

function textResult(message: string, value: JsonRecord) {
  return {
    content: [{ type: "text", text: `${message}\n${JSON.stringify(value, null, 2)}` }],
    structuredContent: value,
  };
}

export class CdpBrowserProvider implements BrowserProvider {
  readonly id = "cdp";
  readonly name = "Chrome DevTools Protocol";
  readonly priority = 50;
  private readonly connection = new CdpConnection();
  private sessionId?: string;
  private targetId?: string;
  private connecting?: Promise<void>;
  private readonly console: JsonRecord[] = [];

  constructor(
    private readonly endpoint: URL,
    private readonly initialUrl: string,
  ) {}

  dispose(): void {
    this.connection.close();
  }

  private async ensureConnected(): Promise<void> {
    if (this.sessionId) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connect(): Promise<void> {
    await this.connection.connect(await browserWebSocketUrl(this.endpoint));
    const created = await this.connection.send("Target.createTarget", {
      url: this.initialUrl,
    });
    this.targetId = requiredString(created, "targetId");
    const attached = await this.connection.send("Target.attachToTarget", {
      targetId: this.targetId,
      flatten: true,
    });
    this.sessionId = requiredString(attached, "sessionId");
    this.connection.onEvent((message) => {
      if (message.sessionId !== this.sessionId) return;
      if (message.method === "Runtime.consoleAPICalled") {
        this.console.push({
          type: message.params?.type,
          timestamp: message.params?.timestamp,
          args: message.params?.args,
        });
      } else if (message.method === "Runtime.exceptionThrown") {
        this.console.push({ type: "exception", details: message.params?.exceptionDetails });
      } else {
        return;
      }
      if (this.console.length > CONSOLE_LIMIT) this.console.shift();
    });
    await Promise.all([
      this.command("Page.enable"),
      this.command("Runtime.enable"),
      this.command("Log.enable"),
    ]);
  }

  private command(method: string, params: JsonRecord = {}, signal?: AbortSignal) {
    if (!this.sessionId) throw new Error("CDP target session is unavailable");
    return this.connection.send(method, params, this.sessionId, signal);
  }

  private async evaluate(expression: string, signal?: AbortSignal): Promise<unknown> {
    const result = await this.command(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      signal,
    );
    const exception = record(result.exceptionDetails);
    if (Object.keys(exception).length) {
      throw new Error(String(exception.text ?? "Browser evaluation failed"));
    }
    return record(result.result).value;
  }

  private async state(signal?: AbortSignal): Promise<JsonRecord> {
    return record(
      await this.evaluate(
        `({ url: location.href, title: document.title, loading: document.readyState !== "complete" })`,
        signal,
      ),
    );
  }

  async call(
    operation: BrowserOperation,
    argumentsValue: JsonRecord,
    signal: AbortSignal,
  ): Promise<unknown> {
    await this.ensureConnected();
    signal.throwIfAborted();
    if (operation === "amiba_browser_open") {
      const url = requiredString(argumentsValue, "url");
      await this.command("Page.navigate", { url }, signal);
      await new Promise((resolve) => setTimeout(resolve, 350));
      return textResult("Browser navigation started.", await this.state(signal));
    }
    if (operation === "amiba_browser_snapshot") {
      const snapshot = record(await this.evaluate(snapshotExpression(), signal));
      return textResult("Browser snapshot.", snapshot);
    }
    if (operation === "amiba_browser_click") {
      const result = record(
        await this.evaluate(
          elementExpression(
            requiredString(argumentsValue, "target"),
            "element.focus(); element.click(); return { ok: true };",
          ),
          signal,
        ),
      );
      if (result.ok !== true) throw new Error(String(result.error));
      return textResult("Browser click completed.", await this.state(signal));
    }
    if (operation === "amiba_browser_type") {
      const text = typeof argumentsValue.text === "string" ? argumentsValue.text : "";
      const result = record(
        await this.evaluate(
          elementExpression(
            requiredString(argumentsValue, "target"),
            `element.focus(); if (element.isContentEditable) element.textContent = ${JSON.stringify(text)}; else { const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set; if (setter) setter.call(element, ${JSON.stringify(text)}); else element.value = ${JSON.stringify(text)}; } element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(text)} })); element.dispatchEvent(new Event("change", { bubbles: true })); if (${argumentsValue.submit === true}) element.form?.requestSubmit(); return { ok: true };`,
          ),
          signal,
        ),
      );
      if (result.ok !== true) throw new Error(String(result.error));
      return textResult("Browser input completed.", await this.state(signal));
    }
    if (operation === "amiba_browser_press") {
      const key = requiredString(argumentsValue, "key").split("+").at(-1) ?? "";
      await this.command("Input.dispatchKeyEvent", { type: "keyDown", key }, signal);
      await this.command("Input.dispatchKeyEvent", { type: "keyUp", key }, signal);
      return textResult("Browser key press completed.", await this.state(signal));
    }
    if (operation === "amiba_browser_scroll") {
      const direction = ["up", "down", "left", "right"].includes(String(argumentsValue.direction))
        ? String(argumentsValue.direction)
        : "down";
      const amount = Math.max(1, Math.min(5_000, Number(argumentsValue.amount) || 600));
      const x = direction === "left" ? -amount : direction === "right" ? amount : 0;
      const y = direction === "up" ? -amount : direction === "down" ? amount : 0;
      await this.evaluate(`window.scrollBy({ left: ${x}, top: ${y}, behavior: "instant" }); true`, signal);
      return textResult("Browser scroll completed.", await this.state(signal));
    }
    if (operation === "amiba_browser_screenshot") {
      const result = await this.command("Page.captureScreenshot", { format: "png" }, signal);
      const data = requiredString(result, "data");
      return {
        content: [
          { type: "text", text: "Browser viewport screenshot." },
          { type: "image", data, mimeType: "image/png" },
        ],
        structuredContent: await this.state(signal),
      };
    }
    const messages = this.console.slice(-100);
    if (argumentsValue.clear === true) this.console.length = 0;
    return textResult("Browser console messages.", {
      ...(await this.state(signal)),
      messages,
    });
  }
}

export const name = "amiba-browser-provider-cdp";
export const inject = ["amibaBrowser"];

/** Register a provider only when an endpoint is explicitly configured. */
export function apply(ctx: Context, config: Config): void {
  const endpoint = config.endpoint?.trim();
  if (!endpoint) return;
  const provider = new CdpBrowserProvider(
    validateEndpoint(endpoint, config.allowRemote === true),
    config.initialUrl?.trim() || "about:blank",
  );
  ctx.effect(
    () => {
      const unregister = ctx.amibaBrowser.registerProvider(provider);
      return () => {
        unregister();
        provider.dispose();
      };
    },
    "amiba-browser-provider-cdp",
  );
}

export const __testing = { isLoopback, validateEndpoint };
