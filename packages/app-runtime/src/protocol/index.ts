/**
 * Stable product protocol between Amiba surfaces and the selected agent
 * runtime. It deliberately contains no adapter implementation types.
 * Runtime adapters translate their native event stream at this boundary.
 */

import type { ImageAttachmentRef } from "@amiba/extension-sdk";

export type MessageImage = { readonly attachment: ImageAttachmentRef };

/** Presentation metadata for one non-image attachment on a user message. */
export interface MessageAttachmentBadge {
  uiId: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "text" | "pdf" | "binary";
  attachmentId?: string;
  thumbDataUrl?: string;
}

/**
 * One attachment of a user message, in the ORIGINAL content order. The
 * surface's attachment row renders these items in sequence — a file capsule
 * natively, an image through the official `conversation.message.images`
 * slot — so files and images keep the interleaving the model actually saw.
 */
export type MessageAttachment =
  | { kind: "file"; badge: MessageAttachmentBadge }
  | { kind: "image"; image: MessageImage };

export type ChatRole = "system" | "user" | "assistant" | "tool";

/**
 * A user-role message that a PLUGIN dispatched on the user's behalf (the
 * steward relaying a task brief, an IM connector relaying an inbound chat
 * message, …) rather than one the person typed into the composer.
 *
 * `plugin` is the DSH plugin name verbatim, straight off the wire
 * (`user/message` `data.source.plugin`) — core attaches no meaning to it and
 * carries no per-plugin vocabulary. A surface that wants to name the producer
 * in the user's language resolves the id through the `amiba.message.source`
 * slot (ui-shell projects those registrations into a label resolver); an id
 * nobody registered renders as itself.
 */
export interface PluginMessageOrigin {
  kind: "plugin";
  plugin: string;
  /** Display name supplied by the message producer, never an authorization identity. */
  senderName?: string;
}

/**
 * A user-role message that is an ACCOUNT of something that just happened
 * rather than something addressed to this session — DSH's `notice` context
 * form ("a one-off account of something that just happened; it supersedes
 * nothing"): a steward task report, a guard's reminder to the model.
 *
 * It rides a user-role message because that is where the model reads it, but
 * nobody said it to anyone, so a surface must not render it as the person
 * speaking. `summary` is the producer's own one-line account (bounded by DSH
 * to 120 characters) and is the whole of what a collapsed row needs to show;
 * the message's `content` is the full body behind it.
 */
/** Opaque, session-scoped entity reference. Plugins own kind and resolution. */
export interface NoticeReference {
  kind: string;
  sessionId: string;
  id: string;
  /** Optional generation discriminator for reusable entity IDs. */
  instance?: string;
}
/** Display placement is independent of the entity opened by reference. */
export type NoticePlacement =
  | { kind: "standalone" }
  | { kind: "execution"; sessionId: string; callId: string };
/** Durable UI-only session event: never injected into model context. */
export interface PresentationNotice {
  version: 1;
  id: string;
  source: string;
  summary: string;
  body: string;
  reference?: NoticeReference;
  placement?: NoticePlacement;
}
export interface MessageNotice {
  summary: string;
  reference?: NoticeReference;
  placement?: NoticePlacement;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Durable Host image references in content order; never local staging IDs. */
  images?: readonly MessageImage[];
  name?: string;
  /** Local-only id used by presentation surfaces. */
  uiId?: string;
  /**
   * Set when this message came from somewhere other than the person at the
   * composer. Absent means the ordinary case: the user typed it.
   */
  origin?: PluginMessageOrigin;
  /**
   * Set when this message is an account of an event rather than a turn in the
   * conversation. Surfaces render it as a collapsed context row keyed by
   * `summary`, never as a user bubble. Always accompanied by an `origin`:
   * only a producer other than the person can file one.
   */
  notice?: MessageNotice;
}

/**
 * Immutable metadata for a file staged by the DSH attachment plugin.
 * Files cross client boundaries only as opaque ids; filesystem paths never
 * enter this protocol.
 */
export interface RuntimeAttachment {
  name: string;
  mime: string;
  size: number;
  kind: "image" | "text" | "pdf" | "binary";
  attachmentId: string;
}

export interface AgentExecutionContext {
  /** Stable Amiba agent/preset id bound to the task. */
  profileId: string;
}

export interface RuntimeModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export const DEFAULT_AGENT_PROFILE_ID = "default";

export function normalizeAgentProfileId(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  return normalized || DEFAULT_AGENT_PROFILE_ID;
}

export function normalizeAgentContext(
  value: Partial<AgentExecutionContext> | null | undefined,
): AgentExecutionContext {
  return {
    profileId: normalizeAgentProfileId(value?.profileId),
  };
}

/** Merged state for one streamed tool call. */
export interface ToolCall {
  index: number;
  id?: string;
  name: string;
  arguments: string;
}

/**
 * Verbatim `tool/call` material, retained beside {@link ToolProgress}'s
 * parsed/flattened conveniences. Present whenever the call frame itself was
 * in the projected window; absent for a result whose call fell outside it
 * (history pagination cuts pairs).
 */
export interface ToolCallWireRecord {
  /** `tool/call` `data.arguments`: the raw JSON string exactly as the model produced it, unparsed. */
  argsRaw: string;
  /** `tool/call` `data.turn`. */
  turn: number;
  /** `tool/call` `data.step`. */
  step: number;
  /** `tool/call` event `time` (unix epoch ms). */
  time: number;
  /**
   * The call frame's host-computed render intent: the `view` member of the
   * accompanying tool event view when its `for` discriminant is `"call"`,
   * else `null`. Type-erased to `unknown` because this protocol carries no
   * adapter types (see the module header); the value is the verbatim wire
   * payload and is re-asserted as `ToolCallView | null` at the presentation
   * boundary that owns the DSH types.
   */
  callView: unknown;
}

/**
 * Verbatim `tool/result` material. Present once the result frame arrived;
 * absent while the call is still running.
 */
export interface ToolResultWireRecord {
  /** `tool/result` event `seq`. */
  seq: number;
  /** `tool/result` event `time` (unix epoch ms). */
  time: number;
  /**
   * The result's content blocks, verbatim and unflattened — the nested
   * tool-result block's own `content` on the real DSH wire (a tool-result
   * message's content is exactly one such block). Type-erased for the same
   * reason as {@link ToolCallWireRecord.callView}: the element type is an
   * open, merge-extensible DSH union that this protocol cannot name.
   */
  content: readonly unknown[];
  /** The tool-result block's `isError` flag, uncollapsed. */
  isError: boolean;
  /** `tool/result` `data.error`: the tool's internal failure identity, when it reported one. */
  error?: { name: string; code: string };
  /** `tool/result` `data.meta`: opaque tool-private presentation payload. */
  meta?: unknown;
  /**
   * The result frame's host-computed render intent: the `view` member of the
   * accompanying tool event view when its `for` discriminant is `"result"`,
   * else `null`. Type-erased like the call-side view.
   */
  resultView: unknown;
}

/**
 * Lossless companion to one {@link ToolProgress} row. The surrounding fields
 * stay exactly what presenters already read (parsed `args`, flattened result
 * text, boolean `error`); this record carries the raw forms alongside so a
 * presentation layer can rebuild the runtime's own frozen call/result node
 * without re-reading the event log. Both producers (durable-log projection
 * and the live mux bridge) fill it; a row without it renders through the
 * host's own tool row and never yields a partially invented node.
 */
export interface ToolWireRecord {
  call?: ToolCallWireRecord;
  result?: ToolResultWireRecord;
  /** DSH Code Dispatch call blocks; adapter types are reasserted by the UI. */
  subCalls?: readonly unknown[];
}

/** Runtime-neutral presentation state for one tool invocation. */
export interface ToolProgress {
  tool: string;
  toolCallId: string;
  status: "running" | "completed";
  label?: string;
  emoji?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: boolean;
  inlineDiff?: string;
  startedAt?: number;
  durationMs?: number;
  /** Verbatim wire material behind the convenience fields above. */
  wire?: ToolWireRecord;
}

/**
 * Correlated approval request. For DSH, requestId is the mux server-request
 * rpcId and must be echoed to /api/respond. Other adapters map their native
 * correlation id into the same field.
 */
export interface ApprovalRequest {
  requestId: string;
  approvalId: string;
  sessionId?: string;
  profileId?: string;
  tool?: string;
  toolCallId?: string;
  command?: string;
  description?: string;
  reason?: string;
  raw?: Record<string, unknown>;
}

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: UserQuestionOption[];
  multiSelect?: boolean;
  /**
   * Official presentation intent (dsh-user-questions): `approve` names the
   * option label that carries the intent's affirmative decision. Today the
   * only kind DSH ships is "plan-review" — a single question whose `detail`
   * is the plan under review.
   */
  intent?: { kind: string; approve: string };
}

/** One answerable request may contain multiple questions. */
export interface UserQuestionRequest {
  requestId: string;
  sessionId?: string;
  /** Optional originating preset label; DSH derives ownership from sessionId. */
  profileId?: string;
  questions: UserQuestionItem[];
  raw?: Record<string, unknown>;
}

export interface UserQuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

export interface RuntimeActionResult {
  ok: boolean;
  error?: string;
  status?: number;
}

export type ApprovalDecision = "once" | "session" | "always" | "deny";
export type ApprovalOutcome =
  | ApprovalDecision
  | "cancelled"
  | "unavailable"
  | "expired"
  | "failed";

export interface ApprovalRecord {
  approvalId: string;
  command?: string;
  tool?: string;
  description?: string;
  reason?: string;
  requestedAt: number;
  outcome?: ApprovalOutcome;
  decidedAt?: number;
}

export const APPROVAL_DEFAULT_TIMEOUT_MS = 300_000;

export interface SubmitPayload {
  sessionId: string;
  sessionTitle?: string;
  assistantUiId: string;
  history: ChatMessage[];
  /** Attachments belonging to the final user message in history. */
  attachments?: RuntimeAttachment[];
  /**
   * `<file-attachment>` metadata blocks for those attachments, sent as their
   * OWN text part ahead of the user's text instead of being concatenated
   * into it. Keeping the wire copy separate is what lets a reloaded
   * transcript render the user's words without regex surgery.
   */
  attachmentPrompt?: string;
  agent?: AgentExecutionContext;
  /** Draft choice applied after session.create and before the first prompt. */
  modelSelection?: RuntimeModelSelection;
}

/** Host admission, distinct from the eventual model/command outcome. */
export type SubmitReceipt =
  | { kind: "accepted"; command?: { kind: "success" | "error"; text?: string } }
  | { kind: "rejected" | "unconfirmed"; error: string };

/** Presentation evidence from DSH's compaction lifecycle, scoped to one session. */
export interface CompactionProgress {
  compactionId: string;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt?: number;
  endedAt?: number;
  summary?: string;
  shadowedItemCount?: number;
  shadowedTokenCount?: number;
  error?: string;
}

export type CompactionUpdate = Pick<CompactionProgress, "compactionId"> & Partial<Omit<CompactionProgress, "compactionId">>;

export interface AssistantTextSourceRange {
  start: number;
  end: number;
  runtimeStep?: number;
  runtimeSeq?: number;
}

export interface RetryProgress {
  id: string;
  attempt: number;
  delayMs: number;
  startedAt: number;
  status: "waiting" | "started";
}

export type AssistantTimelineItem =
  | {
      kind: "text";
      id: string;
      text: string;
      /** Exact finalized assistant/message event, absent for unattributed chunks. */
      runtimeSeq?: number;
      /** Source ranges within unchanged, possibly merged streaming text. */
      sourceRanges?: AssistantTextSourceRange[];
    }
  | { kind: "reasoning"; id: string; text: string; startedAt?: number; endedAt?: number }
  | { kind: "tool"; id: string; toolCallId: string }
  | { kind: "approval"; id: string; approvalId: string }
  | { kind: "retry"; id: string; retry: RetryProgress }
  | { kind: "compaction"; id: string; compaction: CompactionProgress };

export interface ChatRuntimeError {
  message: string;
  status?: number;
  hint?: string;
}

/** Input excludes separately reported cache reads and writes. */
export interface MessageTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ChatRuntimeState {
  sessionId: string;
  assistantUiId: string | null;
  streaming: boolean;
  assistantText: string;
  /** Durable identity of the completed turn’s closing assistant, when available. */
  assistantMessageId?: string;
  assistantSentAt?: number;
  tokenUsage?: MessageTokenUsage;
  /** Exact DSH engine turn number, never a display ordinal. */
  runtimeTurn?: number;
  reasoning: string;
  /** Wall-clock bounds of the reasoning stream; null until the first delta. */
  reasoningStartedAt: number | null;
  reasoningEndedAt: number | null;
  toolCalls: ToolCall[];
  toolOrder: string[];
  toolProgress: ToolProgress[];
  timeline: AssistantTimelineItem[];
  error: ChatRuntimeError | null;
  agentFinalUrl: string | null;
  agentFinalTitle: string | null;
  pendingApprovals: ApprovalRequest[];
  pendingQuestions: UserQuestionRequest[];
  /** Optional adapter-native turn correlation; never used to answer waits. */
  turnId: string | null;
  startedAt: number;
  updatedAt: number;
}

export const CHAT_PORT_NAME = "amiba-chat";

export type ClientToEngineMessage =
  | { type: "subscribe"; sessionId: string }
  | { type: "snapshot"; sessionId: string }
  | { type: "submit"; payload: SubmitPayload }
  | { type: "abort"; sessionId: string }
  | { type: "clear"; sessionId: string }
  | { type: "clearApproval"; sessionId: string; approvalId: string }
  | {
      type: "respondApproval";
      request: ApprovalRequest;
      decision: ApprovalDecision;
    }
  | {
      type: "respondQuestions";
      request: UserQuestionRequest;
      answers: UserQuestionAnswerItem[];
    };

export type SnapshotFrame = {
  /** Authoritative session activity when this renderer does not own the turn. */
  hostRunning?: boolean;
} & (
  | {
      type: "snapshot";
      sessionId: string;
      kind: "absent";
      /**
       * Host-owned interaction waits (ask-user questions / approvals) that
       * outlive any in-memory turn state: DSH keeps them pending until
       * answered, so a session opened after a reload still carries them
       * even though the engine has no run state to snapshot.
       */
      pendingQuestions?: UserQuestionRequest[];
      pendingApprovals?: ApprovalRequest[];
    }
  | {
      type: "snapshot";
      sessionId: string;
      kind: "live";
      state: ChatRuntimeState;
    }
  | {
      type: "snapshot";
      sessionId: string;
      kind: "interrupted";
      state: ChatRuntimeState;
    }
  | {
      type: "snapshot";
      sessionId: string;
      kind: "completed";
      state: ChatRuntimeState;
    }
);

export type EngineToClientMessage =
  | SnapshotFrame
  | { type: "event"; sessionId: string; event: StreamEvent };

export type StreamEvent =
  | { kind: "begin"; assistantUiId: string }
  | { kind: "assistantMessage"; messageId: string; sentAt?: number; tokenUsage?: MessageTokenUsage }
  | { kind: "chunk"; text: string; runtimeStep?: number }
  | { kind: "assistantTextSource"; phase: "reset"; runtimeStep: number }
  | { kind: "assistantTextSource"; phase: "final"; runtimeStep: number; runtimeSeq: number; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "toolCalls"; calls: ToolCall[] }
  | { kind: "toolProgress"; event: ToolProgress }
  | { kind: "retry"; event: RetryProgress }
  | { kind: "compaction"; event: CompactionUpdate }
  | { kind: "session"; sessionId: string }
  | { kind: "turn"; turnId: string; runtimeTurn?: number }
  | { kind: "approvalRequest"; request: ApprovalRequest }
  | { kind: "approvalResolved"; approvalId: string }
  | { kind: "questionRequest"; request: UserQuestionRequest }
  | { kind: "questionResolved"; requestId: string }
  /** The runtime's session-title projection changed (auto-generated title). */
  | { kind: "sessionTitle"; title: string }
  /**
   * A user-role message the HOST put into the session — a plugin dispatching
   * on the user's behalf, never the local composer (which appends its own
   * bubble before submitting). `uiId` is the same id the durable-log
   * projection derives, so the live bubble and the reloaded one are one
   * message.
   */
  | {
      kind: "userMessage";
      uiId: string;
      content: string;
      images?: ChatMessage["images"];
      attachmentBadges?: Array<MessageAttachmentBadge>;
      /**
       * Attachments in the message's original content order, when the
       * producer's message carried them; the surface interleaves file and
       * image items from this list.
       */
      attachments?: readonly MessageAttachment[];
      /** Wall-clock time of the durable user-message event. */
      sentAt: number;
      origin?: ChatMessage["origin"];
      /** Present iff this is an account, not a turn — see {@link MessageNotice}. */
      notice?: ChatMessage["notice"];
    }
  | { kind: "done"; agentFinalUrl?: string; agentFinalTitle?: string }
  /**
   * `assistantUiId` names the bubble this settles when it is NOT the one the
   * surface is currently streaming — a HOST-started run displaced by a local
   * submit. Absent (the ordinary case) means "the run in progress", which
   * the surface seals as `[stopped]`.
   */
  | { kind: "aborted"; assistantUiId?: string }
  | { kind: "error"; message: string; status?: number; hint?: string };

export interface ChatEngineClient {
  subscribe(sessionId: string): void;
  requestSnapshot(sessionId: string): void;
  submit(payload: SubmitPayload): void;
  /** Optional for older transports. Unconfirmed admission must not imply safe retry. */
  submitWithReceipt?(payload: SubmitPayload): Promise<SubmitReceipt>;
  abort(sessionId: string): void;
  clear(sessionId: string): void;
  clearApproval(sessionId: string, approvalId: string): void;
  respondToApproval(
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ): Promise<RuntimeActionResult>;
  respondToQuestions(
    request: UserQuestionRequest,
    answers: UserQuestionAnswerItem[],
  ): Promise<RuntimeActionResult>;
  /** Reject the whole wait; DSH resolves the ask tool call as cancelled. */
  cancelQuestions(request: UserQuestionRequest): Promise<RuntimeActionResult>;
  onSnapshot(cb: (frame: SnapshotFrame) => void): () => void;
  onStreamEvent(
    cb: (sessionId: string, event: StreamEvent) => void,
  ): () => void;
  dispose(): void;
}

export interface ChatEngineTransport {
  postMessage(msg: ClientToEngineMessage): void;
  onMessage(cb: (msg: EngineToClientMessage) => void): () => void;
}
