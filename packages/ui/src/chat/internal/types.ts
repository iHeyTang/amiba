/**
 * UI-level message shape used by the chat bubble renderer.
 *
 * Distinct from the wire-protocol types in @amiba/core:
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
  HermesToolProgress
} from "@amiba/core"

export interface UiMessage extends ChatMessage {
  uiId: string
  streaming?: boolean
  /**
   * Workspace bound to this user turn. Fresh messages store it explicitly so
   * the conversation can show a compact context badge immediately; restored
   * legacy messages derive the same value from their `<workspace>` block.
   */
  workspacePath?: string
  /**
   * Pages attached as system context for this turn (live current tab and/or
   * pinned snapshots). Persisted alongside the message so the provenance
   * chip survives panel reloads.
   */
  pageBadges?: Array<{ title: string; url: string }>
  /**
   * @deprecated Older sessions saved a single attachment under `pageBadge`.
   * Still read for backward compatibility but never written to again.
   */
  pageBadge?: { title: string; url: string }
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
   * Hermes `reasoning.available` text. In current gateways this is an
   * intermediate progress note, not a reliable chain-of-thought channel.
   * The UI may show the latest note while a run is active and discards it
   * from the completed execution record.
   */
  reasoning?: string
  /** Live tool-progress events from the gateway, rendered as chips. */
  hermesToolProgress?: HermesToolProgress[]
  /**
   * Per-event timeline preserving the real interleave of model text and
   * tool calls as they streamed in. Each item carries a stable `id` so
   * React keys are stable across rehydration.
   */
  assistantTimeline?: AssistantTimelineItem[]
  /**
   * Approvals that fired during this assistant turn — including resolved
   * ones. The above-composer banner is only for in-flight prompts; this
   * is the persistent audit trail that lives on the message itself.
   */
  hermesApprovalRecords?: ApprovalRecord[]
}

/**
 * Interleaved text + tool + approval items in the order they streamed in.
 * Matches `AssistantTimelineItem` in @amiba/core, but kept locally so the
 * UI can extend it later without breaking the wire protocol.
 */
export type AssistantTimelineItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; toolCallId: string }
  | { kind: "approval"; id: string; approvalId: string }

/** Errors a chat surface needs to render (top-level banner or per-bubble). */
export interface ChatError {
  message: string
  hint?: string
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
