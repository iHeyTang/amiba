/**
 * Stable product protocol between Amiba surfaces and the selected agent
 * runtime. It deliberately contains no adapter implementation types.
 * Runtime adapters translate their native event stream at this boundary.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  /** Local-only id used by presentation surfaces. */
  uiId?: string;
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
  agent?: AgentExecutionContext;
  /** Draft choice applied after session.create and before the first prompt. */
  modelSelection?: RuntimeModelSelection;
}

export type AssistantTimelineItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; toolCallId: string }
  | { kind: "approval"; id: string; approvalId: string };

export interface ChatRuntimeError {
  message: string;
  status?: number;
  hint?: string;
}

export interface ChatRuntimeState {
  sessionId: string;
  assistantUiId: string | null;
  streaming: boolean;
  assistantText: string;
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

export type SnapshotFrame =
  | { type: "snapshot"; sessionId: string; kind: "absent" }
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
    };

export type EngineToClientMessage =
  | SnapshotFrame
  | { type: "event"; sessionId: string; event: StreamEvent };

export type StreamEvent =
  | { kind: "begin"; assistantUiId: string }
  | { kind: "chunk"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "toolCalls"; calls: ToolCall[] }
  | { kind: "toolProgress"; event: ToolProgress }
  | { kind: "session"; sessionId: string }
  | { kind: "turn"; turnId: string }
  | { kind: "approvalRequest"; request: ApprovalRequest }
  | { kind: "approvalResolved"; approvalId: string }
  | { kind: "questionRequest"; request: UserQuestionRequest }
  | { kind: "questionResolved"; requestId: string }
  | { kind: "done"; agentFinalUrl?: string; agentFinalTitle?: string }
  | { kind: "aborted" }
  | { kind: "error"; message: string; status?: number; hint?: string };

export interface ChatEngineClient {
  subscribe(sessionId: string): void;
  requestSnapshot(sessionId: string): void;
  submit(payload: SubmitPayload): void;
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
