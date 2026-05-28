/**
 * Transport-agnostic interface the chat UI uses to talk to its engine.
 *
 * Two implementations are expected:
 *
 *   - **Extension**: `ChromeChatEngineClient` — wraps a
 *     `chrome.runtime.Port` (long-lived) plus `chrome.runtime.sendMessage`
 *     for one-shot calls. The engine runs in the MV3 service worker.
 *   - **Desktop**: `ElectronChatEngineClient` — wraps IPC to the Electron
 *     main process. The engine runs in main (Node.js) directly.
 *
 * The UI never imports either implementation directly; the app entry hands
 * one in via `<ChatView client={...} />`.
 */

import type {
  ClientToEngineMessage,
  EngineToClientMessage,
  SnapshotFrame,
  StreamEvent,
  SubmitPayload
} from "./chat-engine-protocol"

export interface ChatEngineClient {
  /**
   * Subscribe to a session's stream. The engine will (re-)deliver a
   * snapshot and then push every subsequent event for that session.
   */
  subscribe(sessionId: string): void

  /** Request a fresh snapshot without changing subscription. */
  requestSnapshot(sessionId: string): void

  /** Start one assistant turn. */
  submit(payload: SubmitPayload): void

  /** Cancel an in-flight turn. */
  abort(sessionId: string): void

  /** Drop the engine's runtime state for this session (e.g. on session clear). */
  clear(sessionId: string): void

  /** Acknowledge that an approval prompt is no longer needed. */
  clearApproval(sessionId: string, approvalId: string): void

  /** Subscribe to engine-pushed snapshot frames. Returns unsubscribe. */
  onSnapshot(cb: (frame: SnapshotFrame) => void): () => void

  /** Subscribe to engine-pushed stream events. Returns unsubscribe. */
  onStreamEvent(cb: (sessionId: string, event: StreamEvent) => void): () => void

  /** Lifecycle: tear down the channel. Idempotent. */
  dispose(): void
}

/**
 * Convenience type alias: anything that can route a `ClientToEngineMessage`
 * frame and surface `EngineToClientMessage` frames back. Useful when an
 * implementation wants to share dispatch logic across both directions.
 */
export interface ChatEngineTransport {
  postMessage(msg: ClientToEngineMessage): void
  onMessage(cb: (msg: EngineToClientMessage) => void): () => void
}
