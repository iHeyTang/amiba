import type {
  ChatEngineClient,
  ClientToEngineMessage,
  EngineToClientMessage,
  SnapshotFrame,
  StreamEvent,
  SubmitPayload
} from "@amiba/core"

type SnapshotListener = (frame: SnapshotFrame) => void
type StreamListener = (sessionId: string, event: StreamEvent) => void

/**
 * Real ChatEngineClient for desktop. Wraps the preload bridge
 * (`window.hermes.chat`) to talk to the chat engine running in Electron
 * main process. The engine itself calls the same HermesClient gateway
 * code path the extension uses — there's a single source of truth for
 * the HTTP/SSE protocol.
 */
export class ElectronChatEngineClient implements ChatEngineClient {
  private snapshotListeners = new Set<SnapshotListener>()
  private streamListeners = new Set<StreamListener>()
  private unsubBridge: (() => void) | null = null

  constructor() {
    this.unsubBridge = window.hermes.chat.onMessage((msg: EngineToClientMessage) => {
      if (msg.type === "event") {
        for (const cb of this.streamListeners) cb(msg.sessionId, msg.event)
      } else if (msg.type === "snapshot") {
        for (const cb of this.snapshotListeners) cb(msg)
      }
    })
  }

  private send(msg: ClientToEngineMessage): void {
    void window.hermes.chat.send(msg)
  }

  subscribe(sessionId: string): void {
    this.send({ type: "subscribe", sessionId })
  }

  requestSnapshot(sessionId: string): void {
    this.send({ type: "snapshot", sessionId })
  }

  submit(payload: SubmitPayload): void {
    this.send({ type: "submit", payload })
  }

  abort(sessionId: string): void {
    this.send({ type: "abort", sessionId })
  }

  clear(sessionId: string): void {
    this.send({ type: "clear", sessionId })
  }

  clearApproval(sessionId: string, approvalId: string): void {
    this.send({ type: "clearApproval", sessionId, approvalId })
  }

  onSnapshot(cb: SnapshotListener): () => void {
    this.snapshotListeners.add(cb)
    return () => this.snapshotListeners.delete(cb)
  }

  onStreamEvent(cb: StreamListener): () => void {
    this.streamListeners.add(cb)
    return () => this.streamListeners.delete(cb)
  }

  dispose(): void {
    this.snapshotListeners.clear()
    this.streamListeners.clear()
    this.unsubBridge?.()
    this.unsubBridge = null
  }
}
