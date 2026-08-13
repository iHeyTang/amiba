/**
 * Wire-protocol types for the Hermes gateway SSE stream.
 *
 * These describe what the LLM gateway emits on top of OpenAI-compatible
 * Chat Completions — tool progress, approval requests, etc. Engine
 * implementations (HermesClient class in extension; future desktop
 * equivalent in Electron main) emit/consume these types directly.
 *
 * The actual `HermesClient` class is NOT in this package — only the
 * shapes are shared. Each engine surface (chrome SW vs Electron main)
 * owns its own HTTP/SSE implementation, but they must use these wire
 * types so the UI layer (packages/chat-ui) can render either source.
 */

/** Merged state for one streamed function tool call (OpenAI-style deltas). */
export interface StreamedToolCall {
  index: number
  id?: string
  name: string
  arguments: string
}

/**
 * One `event: hermes.tool.progress` frame. The gateway emits these as a
 * separate SSE channel from `delta.content` so frontends can show a live
 * tool trace without polluting the assistant's final answer. `status` is
 * `"running"` on tool start and `"completed"` on finish — pair them by
 * `toolCallId`.
 */
export interface HermesToolProgress {
  tool: string
  toolCallId: string
  status: "running" | "completed"
  label?: string
  emoji?: string
  /** Redacted structured arguments from Hermes's authoritative tool callback. */
  args?: Record<string, unknown>
  /** Bounded, redacted tool result used by tool-specific inspection views. */
  result?: unknown
  /** True when Hermes classified the tool result as a failure. */
  error?: boolean
  /** Bounded ANSI diff emitted for file-mutating tools. */
  inlineDiff?: string
  /** Wall-clock ms when the engine first saw a `running` event. */
  startedAt?: number
  /** Elapsed wall-clock between the matching `running` and this `completed`. */
  durationMs?: number
}

export type HermesLiveAgentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"

export type HermesLiveAgentEventType =
  | "subagent.spawn_requested"
  | "subagent.start"
  | "subagent.tool"
  | "subagent.progress"
  | "subagent.thinking"
  | "subagent.complete"

/** Incremental state for one delegated Hermes agent. */
export interface HermesLiveAgent {
  id: string
  eventType: HermesLiveAgentEventType
  parentId: string | null
  goal: string
  childSessionId?: string
  model?: string
  status: HermesLiveAgentStatus
  taskCount: number
  taskIndex: number
  startedAt: number
  updatedAt: number
  durationSeconds?: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  toolCount?: number
  filesRead: string[]
  filesWritten: string[]
  currentTool?: string
  progress?: string
  summary?: string
}

/**
 * One `event: approval.request` frame. Sent when the agent is about to
 * execute something dangerous and needs user consent before it proceeds.
 * The agent's tool is paused server-side until we POST
 * `/v1/runs/{runId}/approval`.
 */
export interface HermesApprovalRequest {
  approvalId: string
  runId: string
  /** Named Hermes profile that owns the run; needed for approval routing. */
  profileId?: string
  tool?: string
  command?: string
  description?: string
  reason?: string
  /** Raw event payload — kept for forward-compat / debugging. */
  raw: Record<string, unknown>
}

export type HermesApprovalDecision = "once" | "session" | "always" | "deny"

/**
 * Final state of an approval: either the user's chosen decision, the
 * gateway's auto-timeout, or a local POST failure.
 */
export type ApprovalOutcome = HermesApprovalDecision | "expired" | "failed"

/**
 * One approval, persisted into the assistant message so users can review
 * past approvals long after the banner closed.
 */
export interface ApprovalRecord {
  approvalId: string
  command?: string
  tool?: string
  description?: string
  reason?: string
  /** ms epoch when the gateway first emitted this approval.request. */
  requestedAt: number
  /** Undefined while pending; assigned once the approval settles. */
  outcome?: ApprovalOutcome
  /** ms epoch when `outcome` was assigned. */
  decidedAt?: number
}

/**
 * Server-side default for `approvals.gateway_timeout`. Mirrors
 * `tools/approval.py:1219` so the UI can render an accurate countdown
 * without round-tripping for the config value.
 */
export const HERMES_APPROVAL_GATEWAY_TIMEOUT_MS = 300_000
