import {
  CHAT_PORT_NAME,
  type ChatEngineClient,
  type ClientToEngineMessage,
  type EngineToClientMessage,
  type SnapshotFrame,
  type StreamEvent,
  type SubmitPayload,
} from "@amiba/core";

type SnapshotListener = (frame: SnapshotFrame) => void;
type StreamListener = (sessionId: string, event: StreamEvent) => void;

/**
 * Wraps the extension's `chrome.runtime.Port` to the background-SW chat
 * engine as a ChatEngineClient. Reconnects lazily on disconnect — the
 * SW restarts can sever the port mid-stream; the next post triggers a
 * fresh connect. Re-subscribe is the SidePanel's job (it calls
 * `client.subscribe(activeId)` whenever the active session changes).
 */
export class ChromeChatEngineClient implements ChatEngineClient {
  private port: chrome.runtime.Port | null = null;
  private snapshotListeners = new Set<SnapshotListener>();
  private streamListeners = new Set<StreamListener>();

  private ensurePort(): chrome.runtime.Port | null {
    if (this.port) return this.port;
    try {
      const port = chrome.runtime.connect({ name: CHAT_PORT_NAME });
      port.onMessage.addListener((raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const msg = raw as EngineToClientMessage;
        if (msg.type === "snapshot") {
          for (const cb of this.snapshotListeners) cb(msg);
        } else if (msg.type === "event") {
          for (const cb of this.streamListeners) cb(msg.sessionId, msg.event);
        }
      });
      port.onDisconnect.addListener(() => {
        this.port = null;
      });
      this.port = port;
      return port;
    } catch (e) {
      console.warn("[chrome-engine-client] connect failed:", e);
      return null;
    }
  }

  private send(msg: ClientToEngineMessage): void {
    const port = this.ensurePort();
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch (e) {
      console.warn("[chrome-engine-client] postMessage failed:", e);
    }
  }

  subscribe(sessionId: string): void {
    this.send({ type: "subscribe", sessionId });
  }

  requestSnapshot(sessionId: string): void {
    this.send({ type: "snapshot", sessionId });
  }

  submit(payload: SubmitPayload): void {
    this.send({ type: "submit", payload });
  }

  abort(sessionId: string): void {
    this.send({ type: "abort", sessionId });
  }

  clear(sessionId: string): void {
    this.send({ type: "clear", sessionId });
  }

  clearApproval(sessionId: string, approvalId: string): void {
    this.send({ type: "clearApproval", sessionId, approvalId });
  }

  onSnapshot(cb: SnapshotListener): () => void {
    this.snapshotListeners.add(cb);
    return () => this.snapshotListeners.delete(cb);
  }

  onStreamEvent(cb: StreamListener): () => void {
    this.streamListeners.add(cb);
    return () => this.streamListeners.delete(cb);
  }

  dispose(): void {
    this.snapshotListeners.clear();
    this.streamListeners.clear();
    try {
      this.port?.disconnect();
    } catch {
      // Best-effort.
    }
    this.port = null;
  }
}
