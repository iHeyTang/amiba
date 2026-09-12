import type { CompactionProgress } from "@amiba/app-runtime/protocol"
/**
 * UI-level message shape used by the chat bubble renderer.
 *
 * Distinct from the wire-protocol types in @amiba/app-runtime/core:
 *
 *   - `ChatRuntimeState` (core) — what the engine sends on the port.
 *   - `UiMessage` (here)        — what the React component renders, which
 *                                 includes locally-derived UI state (streaming
 *                                 flag, persisted badges, timeline applied to
 *                                 this specific message).
 *
 * Keeping the two separate lets the engine protocol evolve independently of
 * the UI rendering shape — and matches how the extension's SidePanel kept
 * these as private inline types before the lift.
 */

import type {
  ApprovalRecord,
  AttachmentBadge,
  ChatMessage,
  ToolProgress
} from "@amiba/app-runtime/core"

export interface UiMessage extends ChatMessage {
  uiId: string
  /** Wall-clock time when this message entered the session. */
  sentAt?: number
  /** DSH append-only event sequence used for fork-at-message operations. */
  runtimeSeq?: number
  streaming?: boolean
  /** Workspace bound to this user turn for immediate local presentation. */
  workspacePath?: string
  /**
   * Files (images / text) the user uploaded with this turn. Persisted as
   * lightweight metadata + a downscaled image thumbnail so the chip /
   * preview survives panel reloads without storing the full payload.
   */
  attachmentBadges?: AttachmentBadge[]
  /**
   * URL/title the agent's tab ended up on after this assistant turn.
   * Surfaced as an "Open in my browser →" chip on the assistant bubble.
   * Only populated when the engine's `runTarget` was the agent surface
   * at end of turn (user-only turns skip the chip).
   */
  agentFinalUrl?: string
  agentFinalTitle?: string
  /** Streamed tool-argument markdown kept for backward-compatible details. */
  streamVerbose?: string
  /**
   * Runtime reasoning text. Accumulated across the whole run; the UI shows
   * a live fold while streaming and keeps a collapsed "thought for …" fold
   * on the completed message.
   */
  reasoning?: string
  /** Wall-clock duration of the reasoning stream in milliseconds. */
  reasoningMs?: number
  /** Wall-clock span of the whole process phase (first reasoning/tool
   *  activity → last), shown as the aggregate's natural total. */
  processMs?: number
  /** Live tool-progress events from DSH, rendered as chips. */
  toolProgress?: ToolProgress[]
  /**
   * Per-event timeline preserving the real interleave of model text and
   * tool calls as they streamed in. Each item carries a stable `id` so
   * React keys are stable across rehydration.
   */
  /** Canonical DSH closing message, never the synthetic bubble id. */
  assistantMessageId?: string
  /** Exact DSH engine turn, shared by live and historical projections. */
  runtimeTurn?: number
  assistantDraftSource?: Extract<AssistantTimelineItem, {kind:"text"}>
  assistantTimeline?: AssistantTimelineItem[]
  /**
   * Approvals that fired during this assistant turn — including resolved
   * ones. The above-composer banner is only for in-flight prompts; this
   * is the persistent audit trail that lives on the message itself.
   */
  approvalRecords?: ApprovalRecord[]
}

/**
 * Interleaved text + tool + approval items in the order they streamed in.
 * Matches `AssistantTimelineItem` in @amiba/app-runtime/core, but kept locally so the
 * UI can extend it later without breaking the wire protocol.
 */
export type AssistantTimelineItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "reasoning"; id: string; text: string; startedAt?: number; endedAt?: number }
  | { kind: "tool"; id: string; toolCallId: string }
  | { kind: "approval"; id: string; approvalId: string }
  | { kind: "compaction"; id: string; compaction: CompactionProgress }

/** Errors a chat surface needs to render (top-level banner or per-bubble). */
export interface ChatError {
  message: string
  /** HTTP status preserved from the engine whenever one is available. */
  status?: number
  hint?: string
  /** Origin for errors raised locally rather than by the chat runtime. */
  source?: "run"
}

/**
 * Width preset for the messages column in "fullscreen" surfaces (standalone
 * chat tab). The composer keeps a fixed cap regardless; only the message
 * flow above it resizes. Ignored in the narrow side-panel layout.
 */
export type MessagesMaxWidth = "narrow" | "comfortable" | "full"

/**
 * Capped height for the user bubble in its default (collapsed) state.
 * Short enough that even a long pasted prompt doesn't dominate the panel,
 * but tall enough to convey "this is the question" at a glance. The Tailwind
 * class and px constant must stay in sync.
 */
export const CAPPED_HEIGHT_CLASS = "max-h-24"
export const CAPPED_HEIGHT_PX = 96 // 6rem

/**
 * Cap used in the expanded state. Without a cap here, expanding a very long
 * message would grow the bubble's flow space to its full natural height —
 * and because the bubble is sticky-positioned, that pushes assistant content
 * below down, often off-screen. 60vh leaves ≥40% of the viewport for the
 * answer; longer messages scroll inside the bubble.
 */
export const EXPANDED_MAX_HEIGHT_CLASS = "max-h-[60vh]"

export const COMPOSER_TEXTAREA_MAX_PX = 200
