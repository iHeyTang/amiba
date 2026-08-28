import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatEngineClient,
  ChatRuntimeState,
  RuntimeActionResult,
  RuntimeAttachment,
  RuntimeModelSelection,
  SnapshotFrame,
  StreamEvent,
  SubmitPayload,
  UserQuestionAnswerItem,
  UserQuestionRequest,
} from "../protocol/index.js";
import type { AgentAttachmentsAdapter } from "../platform/index.js";

import { DshAmibaEventBridge } from "./amiba-event-bridge.js";
import type {
  DshApiClient,
  DshImageMediaType,
  DshMuxEnvelope,
  DshPromptContentPart,
} from "./index.js";

interface SessionState extends ChatRuntimeState {
  controller?: AbortController;
}

export interface DshChatEngineOptions {
  client: DshApiClient;
  attachments?: AgentAttachmentsAdapter;
  resolveSession?: (
    payload: SubmitPayload,
    signal: AbortSignal,
  ) => Promise<{ cwd?: string; workspaceId?: string; agentPreset?: string }>;
  selectModel?: (
    sessionId: string,
    selection: RuntimeModelSelection,
    signal: AbortSignal,
  ) => Promise<void>;
}

type SnapshotListener = (frame: SnapshotFrame) => void;
type StreamListener = (sessionId: string, event: StreamEvent) => void;

function initialState(sessionId: string, assistantUiId: string): SessionState {
  const now = Date.now();
  return {
    sessionId,
    assistantUiId,
    streaming: true,
    assistantText: "",
    reasoning: "",
    reasoningStartedAt: null,
    reasoningEndedAt: null,
    toolCalls: [],
    toolOrder: [],
    toolProgress: [],
    timeline: [],
    error: null,
    agentFinalUrl: null,
    agentFinalTitle: null,
    pendingApprovals: [],
    pendingQuestions: [],
    turnId: null,
    startedAt: now,
    updatedAt: now,
  };
}

function snapshotOf(sessionId: string, state?: SessionState): SnapshotFrame {
  if (!state) return { type: "snapshot", sessionId, kind: "absent" };
  const visible: ChatRuntimeState = { ...state };
  delete (visible as Partial<SessionState>).controller;
  if (state.streaming) return { type: "snapshot", sessionId, kind: "live", state: visible };
  if (state.error) return { type: "snapshot", sessionId, kind: "interrupted", state: visible };
  return { type: "snapshot", sessionId, kind: "completed", state: visible };
}

function lastUserText(payload: SubmitPayload): string {
  for (let index = payload.history.length - 1; index >= 0; index -= 1) {
    const message = payload.history[index];
    if (message?.role === "user") return message.content;
  }
  throw new Error("DSH turn requires a user message.");
}

function imageMediaType(attachment: RuntimeAttachment): DshImageMediaType | null {
  const mime = attachment.mime.toLowerCase();
  if (mime === "image/png") return "image/png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/webp") return "image/webp";
  if (mime === "image/gif") return "image/gif";
  return null;
}

async function promptAttachments(
  adapter: AgentAttachmentsAdapter | undefined,
  attachments: RuntimeAttachment[] | undefined,
): Promise<DshPromptContentPart[]> {
  if (!attachments?.length) return [];
  if (!adapter) throw new Error("DSH attachment plugin is unavailable.");
  const parts: DshPromptContentPart[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue;
    const stored = await adapter.readForPrompt(attachment.attachmentId);
    const mediaType = imageMediaType(attachment);
    if (!mediaType || stored.kind !== "image" || stored.size !== attachment.size) {
      throw new Error(`Attachment ${attachment.name} failed image validation.`);
    }
    parts.push({
      type: "image",
      mediaType,
      data: stored.dataBase64,
      name: stored.name,
    });
  }
  return parts;
}

async function waitUntilSubscribed(
  iterator: AsyncIterator<DshMuxEnvelope>,
  sessionId: string,
  bridge: DshAmibaEventBridge,
  emit: (event: StreamEvent) => void,
): Promise<void> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error("DSH events.mux ended before subscription.");
    for (const mapped of bridge.accept(next.value)) {
      if (mapped.sessionId === sessionId) emit(mapped.event);
    }
    if (
      next.value.payload.type === "session/subscribed" &&
      next.value.payload.sessionId === sessionId
    ) {
      return;
    }
  }
}

/**
 * Shared DSH-native chat client. It runs in Web or Electron's renderer and
 * talks only to official DSH HTTP/WebSocket APIs plus plugin Remotes.
 */
export class DshChatEngineClient implements ChatEngineClient {
  private readonly states = new Map<string, SessionState>();
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly streamListeners = new Set<StreamListener>();

  constructor(private readonly options: DshChatEngineOptions) {}

  private emitSnapshot(sessionId: string): void {
    const frame = snapshotOf(sessionId, this.states.get(sessionId));
    for (const listener of this.snapshotListeners) listener(frame);
  }

  private emit(sessionId: string, event: StreamEvent): void {
    const state = this.states.get(sessionId);
    if (state) this.applyEvent(state, event);
    for (const listener of this.streamListeners) listener(sessionId, event);
  }

  private applyEvent(state: SessionState, event: StreamEvent): void {
    switch (event.kind) {
      case "chunk": {
        state.assistantText += event.text;
        const last = state.timeline.at(-1);
        if (last?.kind === "text") last.text += event.text;
        else state.timeline.push({ kind: "text", id: `t_${Date.now()}_${state.timeline.length}`, text: event.text });
        break;
      }
      case "reasoning": {
        state.reasoning += event.text;
        const now = Date.now();
        if (state.reasoningStartedAt === null) state.reasoningStartedAt = now;
        state.reasoningEndedAt = now;
        break;
      }
      case "toolProgress": {
        const index = state.toolProgress.findIndex(
          (item) => item.toolCallId === event.event.toolCallId,
        );
        const prior = index >= 0 ? state.toolProgress[index] : undefined;
        const merged = {
          ...(prior ?? {}),
          ...event.event,
          startedAt: event.event.startedAt ?? prior?.startedAt,
        };
        if (index >= 0) state.toolProgress[index] = merged;
        else {
          state.toolProgress.push(merged);
          state.timeline.push({
            kind: "tool",
            id: `tl_${Date.now()}_${state.timeline.length}`,
            toolCallId: event.event.toolCallId,
          });
        }
        if (!state.toolOrder.includes(event.event.toolCallId)) {
          state.toolOrder.push(event.event.toolCallId);
        }
        break;
      }
      case "turn":
        state.turnId = event.turnId;
        break;
      case "approvalRequest":
        state.pendingApprovals = [
          ...state.pendingApprovals.filter(
            (item) => item.approvalId !== event.request.approvalId,
          ),
          event.request,
        ];
        if (
          !state.timeline.some(
            (item) =>
              item.kind === "approval" &&
              item.approvalId === event.request.approvalId,
          )
        ) {
          state.timeline.push({
            kind: "approval",
            id: `tl_${Date.now()}_${state.timeline.length}`,
            approvalId: event.request.approvalId,
          });
        }
        break;
      case "approvalResolved":
        state.pendingApprovals = state.pendingApprovals.filter(
          (item) => item.approvalId !== event.approvalId,
        );
        break;
      case "questionRequest":
        state.pendingQuestions = [
          ...state.pendingQuestions.filter(
            (item) => item.requestId !== event.request.requestId,
          ),
          event.request,
        ];
        break;
      case "questionResolved":
        state.pendingQuestions = state.pendingQuestions.filter(
          (item) => item.requestId !== event.requestId,
        );
        break;
      case "done":
      case "aborted":
        state.streaming = false;
        break;
      case "error":
        state.streaming = false;
        state.error = {
          message: event.message,
          ...(event.status === undefined ? {} : { status: event.status }),
          ...(event.hint === undefined ? {} : { hint: event.hint }),
        };
        break;
      default:
        break;
    }
    state.updatedAt = Date.now();
  }

  private async run(payload: SubmitPayload, controller: AbortController): Promise<void> {
    const { client } = this.options;
    const sessionId = payload.sessionId;
    try {
      const resolved = (await this.options.resolveSession?.(payload, controller.signal)) ?? {};
      await client.createSession(
        {
          sessionId,
          ...resolved,
          ...(resolved.agentPreset
            ? {}
            : payload.agent?.profileId && payload.agent.profileId !== "default"
              ? { agentPreset: payload.agent.profileId }
              : {}),
        },
        controller.signal,
      );
      if (payload.modelSelection) {
        if (this.options.selectModel) {
          await this.options.selectModel(
            sessionId,
            payload.modelSelection,
            controller.signal,
          );
        } else {
          await client.selectModel(
            { sessionId, ...payload.modelSelection },
            controller.signal,
          );
        }
      }

      const bridge = new DshAmibaEventBridge();
      const iterator = client.events(controller.signal)[Symbol.asyncIterator]();
      try {
        await waitUntilSubscribed(iterator, sessionId, bridge, (event) =>
          this.emit(sessionId, event),
        );
        const imageParts = await promptAttachments(
          this.options.attachments,
          payload.attachments,
        );
        const typed = lastUserText(payload);
        const textParts: DshPromptContentPart[] = [
          // Attachment metadata rides its own part; the user's words ride
          // theirs. An attachment-only send (no typed text) still needs at
          // least one text part, which the metadata part then provides.
          ...(payload.attachmentPrompt
            ? [{ type: "text" as const, text: payload.attachmentPrompt }]
            : []),
          ...(typed || !payload.attachmentPrompt
            ? [{ type: "text" as const, text: typed }]
            : []),
        ];
        const response = await client.prompt(
          sessionId,
          [...textParts, ...imageParts],
          {
            mode: "queue",
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            signal: controller.signal,
          },
        );
        if (response.command) {
          if (response.command.text) {
            this.emit(sessionId, { kind: "chunk", text: response.command.text });
          }
          this.emit(sessionId, { kind: "done" });
          return;
        }
        for (;;) {
          const next = await iterator.next();
          if (next.done) throw new Error("DSH events.mux ended during the turn.");
          let terminal = false;
          for (const mapped of bridge.accept(next.value)) {
            if (mapped.sessionId !== sessionId) continue;
            this.emit(sessionId, mapped.event);
            terminal =
              terminal ||
              mapped.event.kind === "done" ||
              mapped.event.kind === "aborted" ||
              mapped.event.kind === "error";
          }
          if (terminal) return;
        }
      } finally {
        await iterator.return?.(undefined);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit(sessionId, { kind: "aborted" });
      } else {
        this.emit(sessionId, {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      const state = this.states.get(sessionId);
      if (state?.controller === controller) delete state.controller;
    }
  }

  subscribe(sessionId: string): void {
    this.emitSnapshot(sessionId);
  }

  requestSnapshot(sessionId: string): void {
    this.emitSnapshot(sessionId);
  }

  submit(payload: SubmitPayload): void {
    if (this.states.get(payload.sessionId)?.streaming) {
      this.emit(payload.sessionId, {
        kind: "error",
        message: "A stream is already in progress for this session.",
      });
      return;
    }
    const controller = new AbortController();
    const state = initialState(payload.sessionId, payload.assistantUiId);
    state.controller = controller;
    this.states.set(payload.sessionId, state);
    this.emit(payload.sessionId, {
      kind: "begin",
      assistantUiId: payload.assistantUiId,
    });
    void this.run(payload, controller);
  }

  abort(sessionId: string): void {
    void this.options.client.cancel(sessionId).catch(() => {});
    this.states.get(sessionId)?.controller?.abort();
  }

  clear(sessionId: string): void {
    this.abort(sessionId);
    this.states.delete(sessionId);
  }

  clearApproval(sessionId: string, approvalId: string): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    state.pendingApprovals = state.pendingApprovals.filter(
      (item) => item.approvalId !== approvalId,
    );
  }

  async respondToApproval(
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ): Promise<RuntimeActionResult> {
    const sessionId = request.sessionId;
    if (!sessionId) return { ok: false, error: "Approval has no DSH session." };
    try {
      const receipt = await this.options.client.respondApproval(request.requestId, {
        sessionId,
        approvalId: request.approvalId,
        outcome: decision === "deny" ? "rejected" : "allowed-once",
      });
      if (!receipt.accepted) {
        return { ok: false, error: receipt.reason ?? "DSH rejected the response." };
      }
      this.emit(sessionId, {
        kind: "approvalResolved",
        approvalId: request.approvalId,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async respondToQuestions(
    request: UserQuestionRequest,
    answers: UserQuestionAnswerItem[],
  ): Promise<RuntimeActionResult> {
    const sessionId = request.sessionId;
    if (!sessionId) return { ok: false, error: "Question has no DSH session." };
    try {
      const receipt = await this.options.client.respondToQuestions(
        request.requestId,
        { sessionId, answer: { answers } },
      );
      if (!receipt.accepted) {
        return { ok: false, error: receipt.reason ?? "DSH rejected the response." };
      }
      this.emit(sessionId, { kind: "questionResolved", requestId: request.requestId });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onStreamEvent(listener: StreamListener): () => void {
    this.streamListeners.add(listener);
    return () => this.streamListeners.delete(listener);
  }

  dispose(): void {
    for (const state of this.states.values()) state.controller?.abort();
    this.states.clear();
    this.snapshotListeners.clear();
    this.streamListeners.clear();
  }
}
