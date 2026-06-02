/**
 * Wire protocol for the chat-engine ↔ UI channel.
 *
 * In the extension, this protocol runs over a long-lived
 * `chrome.runtime.Port`; in desktop, it'll run over Electron IPC. The shape
 * is identical because both transports just shuttle JSON frames.
 *
 * The engine owns per-session `ChatRuntimeState` (so closing & reopening the
 * UI mid-stream can recover the partial assistant message). The UI owns the
 * persisted message history.
 */

import type { ChatMessage } from "./chat-messages"
import type {
  HermesApprovalRequest,
  HermesToolProgress,
  StreamedToolCall
} from "./hermes-gateway-types"

/**
 * Per-turn read-only context shipped alongside the messages — purely for
 * tool handlers on the agent side, never inlined into the prompt.
 *
 * The flagship use case is ``browser_tab_snapshot``: the chat surface
 * captures the user's current tab at the moment they hit send, and the
 * agent's ``my_browser_active_tab`` tool returns that snapshot for the
 * entire turn — so multi-step tool calls don't drift when the user
 * switches tabs mid-stream.
 *
 * Add new fields here as turn-scoped context surfaces emerge (e.g. focused
 * file in an IDE surface). Anything optional; older clients omit.
 */
export interface TurnMetadata {
  browser_tab_snapshot?: BrowserTabSnapshot
}

/**
 * Frozen view of "the page the user was looking at when they sent". Shape
 * mirrors the live ``my_browser_active_tab`` response so the tool handler
 * can substitute it verbatim. ``captured_at`` is an ms-epoch timestamp.
 */
export interface BrowserTabSnapshot {
  tab_id?: number
  window_id?: number
  url?: string
  title?: string
  favicon?: string
  text?: string
  truncated?: boolean
  full_length?: number
  captured_at: number
}

/** Payload the UI sends on `submit` to start one assistant turn. */
export interface SubmitPayload {
  sessionId: string
  /** Stable uiId of the assistant placeholder bubble the UI just appended. */
  assistantUiId: string
  model: string
  history: ChatMessage[]
  /**
   * SessionDB ``source`` tag for first-time creation of this session.
   * The engine ensures the row exists with this tag before issuing the
   * chat request, so api_server's fallback "auto-create with
   * source=api_server" path never triggers. Optional: when unset the
   * engine falls back to the single canonical local source
   * (``SOURCE_LOCAL``). Provided as a future-proofing hook
   * for surfaces that genuinely need a distinct channel — every
   * existing local surface (extension + desktop main window +
   * Quick-Ask) inherits the default.
   *
   * Only honoured on the FIRST submit per sessionId; later turns
   * re-using the same id see the row already in place and the value
   * is a no-op.
   */
  source?: string
  /**
   * Turn-scoped read-only context for tool handlers (e.g. frozen browser
   * tab snapshot). Never inlined into the prompt; only reaches the agent
   * through the registry's per-turn thread-local. Optional — desktop
   * surfaces and history-replay paths leave it unset.
   */
  turnMetadata?: TurnMetadata
}

/**
 * Interleaved text+tool timeline preserving wire order.
 *
 * The UI's `AssistantTimelineItem` mirrors this exactly so a snapshot from
 * the engine can be rendered directly without translation.
 */
export type AssistantTimelineItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; toolCallId: string }
  | { kind: "approval"; id: string; approvalId: string }

export interface ChatRuntimeError {
  message: string
  status?: number
  hint?: string
}

/** Everything the UI needs to reconstruct an in-flight or just-ended turn. */
export interface ChatRuntimeState {
  sessionId: string
  assistantUiId: string | null
  streaming: boolean
  assistantText: string
  reasoning: string
  toolCalls: StreamedToolCall[]
  hermesOrder: string[]
  hermesToolProgress: HermesToolProgress[]
  timeline: AssistantTimelineItem[]
  error: ChatRuntimeError | null
  /** URL/title the agent tab ended on (agent-window surface only). */
  agentFinalUrl: string | null
  agentFinalTitle: string | null
  /** Approval requests the gateway emitted that haven't been answered yet. */
  pendingApprovals: HermesApprovalRequest[]
  /**
   * `X-Hermes-Run-Id` from the in-flight or last-completed chat
   * completion request. Required to POST approval decisions back.
   * May be `null` on older gateways that don't emit the header.
   */
  runId: string | null
  startedAt: number
  updatedAt: number
}

/**
 * chrome.runtime.Port channel name used by the extension's
 * ChromeChatEngineClient. Kept here (rather than in extension-local code)
 * so the wire-protocol declaration sits next to the message types it
 * carries — both apps reference it by import.
 */
export const CHAT_PORT_NAME = "hermes-chat"

/** UI → engine frames. */
export type ClientToEngineMessage =
  | { type: "subscribe"; sessionId: string }
  | { type: "snapshot"; sessionId: string }
  | { type: "submit"; payload: SubmitPayload }
  | { type: "abort"; sessionId: string }
  | { type: "clear"; sessionId: string }
  | { type: "clearApproval"; sessionId: string; approvalId: string }

/**
 * Snapshot kind tags what the engine knows about this session right now:
 *
 *   - `absent`      — engine has no record at all.
 *   - `live`        — Stream is in flight; `state.streaming === true`.
 *   - `interrupted` — Stream ended with an error (engine restarted mid-
 *                     stream and rewrote `streaming → false` with an error).
 *   - `completed`   — Stream finished cleanly while the UI was unsubscribed.
 */
export type SnapshotFrame =
  | { type: "snapshot"; sessionId: string; kind: "absent" }
  | { type: "snapshot"; sessionId: string; kind: "live"; state: ChatRuntimeState }
  | { type: "snapshot"; sessionId: string; kind: "interrupted"; state: ChatRuntimeState }
  | { type: "snapshot"; sessionId: string; kind: "completed"; state: ChatRuntimeState }

/** engine → UI frames. */
export type EngineToClientMessage =
  | SnapshotFrame
  | { type: "event"; sessionId: string; event: StreamEvent }

/** Live deltas. */
export type StreamEvent =
  | { kind: "begin"; assistantUiId: string }
  | { kind: "chunk"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "toolCalls"; calls: StreamedToolCall[] }
  | { kind: "hermesToolProgress"; event: HermesToolProgress }
  | { kind: "session"; sessionId: string }
  | { kind: "run"; runId: string }
  | { kind: "approvalRequest"; request: HermesApprovalRequest }
  | { kind: "approvalResolved"; approvalId: string }
  | {
      kind: "done"
      /**
       * URL the agent tab ended on, when the just-finished turn ran on the
       * agent surface. Drives the "Open in my browser →" chip on the
       * assistant bubble. Omitted for user-mode turns.
       */
      agentFinalUrl?: string
      agentFinalTitle?: string
    }
  | { kind: "aborted" }
  | { kind: "error"; message: string; status?: number; hint?: string }
