import { upsertCompactionTimeline, interruptOpenCompactions } from "./compaction.js";
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
import { shortId } from "../utils/index.js";

import { DshAmibaEventBridge } from "./amiba-event-bridge.js";
import type {
  DshApiClient,
  DshImageMediaType,
  DshMuxEnvelope,
  DshPromptContentPart,
} from "./index.js";

interface SessionState extends ChatRuntimeState {
  controller?: AbortController;
  /**
   * True for a run this window is only WATCHING: a turn the host started
   * (a plugin, an IM connector, a schedule) that no local `submit()` owns.
   * It has no `controller` — this window cannot abort what it did not start
   * — and `submit()` may replace it outright, since a person typing into
   * the composer takes the session back.
   */
  passive?: boolean;
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

function snapshotOf(
  sessionId: string,
  state: SessionState | undefined,
  pendingQuestions: UserQuestionRequest[],
  pendingApprovals: ApprovalRequest[],
): SnapshotFrame {
  if (!state) {
    return {
      type: "snapshot",
      sessionId,
      kind: "absent",
      ...(pendingQuestions.length ? { pendingQuestions } : {}),
      ...(pendingApprovals.length ? { pendingApprovals } : {}),
    };
  }
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
  // Host-owned interaction waits, keyed session → requestId/approvalId.
  // DSH keeps these pending server-side until answered and REPLAYS them as
  // a baseline on every events.mux connect — this ledger mirrors that, so
  // a session opened after a reload (when `states` is empty) still
  // snapshots its unanswered questions/approvals.
  private readonly questionLedger = new Map<string, Map<string, UserQuestionRequest>>();
  private readonly approvalLedger = new Map<string, Map<string, ApprovalRequest>>();
  private watcherStarted = false;
  private disposed = false;
  private readonly watchController = new AbortController();

  constructor(private readonly options: DshChatEngineOptions) {}

  private emitSnapshot(sessionId: string): void {
    const frame = snapshotOf(
      sessionId,
      this.states.get(sessionId),
      [...(this.questionLedger.get(sessionId)?.values() ?? [])],
      [...(this.approvalLedger.get(sessionId)?.values() ?? [])],
    );
    for (const listener of this.snapshotListeners) listener(frame);
  }

  private emit(sessionId: string, event: StreamEvent): void {
    this.trackInteraction(sessionId, event);
    const state = this.states.get(sessionId);
    if (state) this.applyEvent(state, event);
    for (const listener of this.streamListeners) listener(sessionId, event);
  }

  private trackInteraction(sessionId: string, event: StreamEvent): void {
    switch (event.kind) {
      case "questionRequest": {
        const forSession =
          this.questionLedger.get(sessionId) ??
          new Map<string, UserQuestionRequest>();
        forSession.set(event.request.requestId, event.request);
        this.questionLedger.set(sessionId, forSession);
        break;
      }
      case "questionResolved":
        this.questionLedger.get(sessionId)?.delete(event.requestId);
        break;
      case "approvalRequest": {
        const forSession =
          this.approvalLedger.get(sessionId) ??
          new Map<string, ApprovalRequest>();
        forSession.set(event.request.approvalId, event.request);
        this.approvalLedger.set(sessionId, forSession);
        break;
      }
      case "approvalResolved":
        this.approvalLedger.get(sessionId)?.delete(event.approvalId);
        break;
      default:
        break;
    }
  }

  /**
   * One long-lived events.mux consumer for interaction waits only. The
   * per-turn loop in `run()` owns everything stream-shaped; this watcher
   * exists for the frames that must survive OUTSIDE a turn this window is
   * running: the baseline replay of pending questions/approvals on
   * connect, and live asks arriving while no local turn holds the mux
   * open (a reloaded page, a session driven from another window).
   * Duplicate delivery during a live turn is safe — every consumer
   * (ledger, state, ChatSurface) converges by requestId/approvalId.
   */
  private ensureInteractionWatcher(): void {
    if (this.watcherStarted || this.disposed) return;
    this.watcherStarted = true;
    void this.watchInteractions();
  }

  private async watchInteractions(): Promise<void> {
    const signal = this.watchController.signal;
    while (!this.disposed) {
      try {
        const bridge = new DshAmibaEventBridge();
        for await (const envelope of this.options.client.events(signal)) {
          for (const mapped of bridge.accept(envelope)) {
            const kind = mapped.event.kind;
            if (
              kind === "questionRequest" ||
              kind === "questionResolved" ||
              kind === "approvalRequest" ||
              kind === "approvalResolved" ||
              kind === "sessionTitle"
            ) {
              this.emit(mapped.sessionId, mapped.event);
              continue;
            }
            this.observePassiveFrame(mapped.sessionId, mapped.event);
          }
        }
      } catch {
        // Connection losses are routine (backplane restart, network blips);
        // the retry below reconnects and DSH replays the pending baseline.
      }
      if (this.disposed || signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  /**
   * The stream-shaped half of the watcher: turns a host-started turn into the
   * same events a local `run()` produces, so an open conversation follows a
   * turn nobody in this window submitted.
   *
   * The one rule that keeps it from double-delivering is the `controller`
   * check: while a local run owns a session, ITS iterator is already emitting
   * every frame and the watcher stays out entirely.
   *
   * The precise invariant, since the check runs at PROCESSING time on the
   * watcher's own socket rather than at frame time: a passive run can only
   * be OPENED by a `turn` frame, and every later kind is gated on a passive
   * state already existing, so ordinary lag (the watcher a few frames behind
   * the local run) replays nothing — the stragglers find no passive state.
   * What this does NOT rule out is a watcher lagging a WHOLE turn: if its
   * socket is far enough behind that it processes the local turn's
   * `turn/start` only after `run()` has finished and cleared the controller,
   * it would open a passive run and replay that turn. Accepted: it needs the
   * two sockets to diverge by an entire turn, and the worst outcome is a
   * duplicated bubble on one turn, not corrupted state.
   */
  private observePassiveFrame(sessionId: string, event: StreamEvent): void {
    const state = this.states.get(sessionId);
    if (state?.controller) return;
    switch (event.kind) {
      case "userMessage":
        // Independent of any turn: the bridge only maps plugin-dispatched
        // messages, and one arrives BEFORE the turn it kicks off. Forwarded
        // with no state of its own; the surface dedupes on `uiId`.
        this.emit(sessionId, event);
        return;
      case "turn": {
        if (!state?.passive || !state.streaming) {
          // The assistant bubble id is minted HERE — no local submit chose
          // one — and the surface opens its placeholder on the `begin` that
          // carries it.
          const assistantUiId = shortId("host");
          const passive = initialState(sessionId, assistantUiId);
          passive.passive = true;
          this.states.set(sessionId, passive);
          this.emit(sessionId, { kind: "begin", assistantUiId });
        }
        this.emit(sessionId, event);
        return;
      }
      case "assistantMessage":
      case "chunk":
      case "reasoning":
      case "toolCalls":
      case "toolProgress":
      case "compaction":
        if (!state?.passive) return;
        this.emit(sessionId, event);
        return;
      case "done":
      case "aborted":
      case "error":
        if (!state?.passive) return;
        // `emit` applies the terminal event to the state first (so a
        // listener reading a snapshot mid-dispatch sees a settled run), then
        // the passive state is dropped: this window holds nothing durable
        // for a turn it did not start, and the next host turn opens a fresh
        // one.
        this.emit(sessionId, event);
        if (this.states.get(sessionId)?.passive) this.states.delete(sessionId);
        return;
      default:
        return;
    }
  }

  private applyEvent(state: SessionState, event: StreamEvent): void {
    switch (event.kind) {
      case "assistantMessage":
        state.assistantMessageId = event.messageId;
        break;
      case "chunk": {
        state.assistantText += event.text;
        const last = state.timeline.at(-1);
        if (last?.kind === "text") last.text += event.text;
        else state.timeline.push({ kind: "text", id: `t_${Date.now()}_${state.timeline.length}`, text: event.text });
        break;
      }
      case "reasoning": {
        state.reasoning += event.text;
        const last = state.timeline.at(-1);
        if (last?.kind === "reasoning") { last.text += event.text; last.endedAt = Date.now(); }
        else state.timeline.push({kind:"reasoning",id:`r_${Date.now()}_${state.timeline.length}`,text:event.text,startedAt:Date.now(),endedAt:Date.now()});
        const now = Date.now();
        if (state.reasoningStartedAt === null) state.reasoningStartedAt = now;
        state.reasoningEndedAt = now;
        break;
      }
      case "compaction":
        upsertCompactionTimeline(state.timeline, event.event);
        break;
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
        delete state.assistantMessageId;
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
        interruptOpenCompactions(state.timeline);
        state.streaming = false;
        break;
      case "error":
        interruptOpenCompactions(state.timeline);
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
        const textParts: DshPromptContentPart[] = [
          // Attachment metadata rides its own part; the user's words ride
          // theirs. The composer requires typed text to enable sending, so
          // the engine does not compensate for its absence.
          ...(payload.attachmentPrompt
            ? [{ type: "text" as const, text: payload.attachmentPrompt }]
            : []),
          { type: "text" as const, text: lastUserText(payload) },
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
    this.ensureInteractionWatcher();
    this.emitSnapshot(sessionId);
  }

  requestSnapshot(sessionId: string): void {
    this.emitSnapshot(sessionId);
  }

  submit(payload: SubmitPayload): void {
    const current = this.states.get(payload.sessionId);
    // A PASSIVE run is not this window's to guard: the person typing has
    // taken the session back, and DSH queues the prompt behind whatever the
    // host is running. Only a local run in flight refuses a second submit.
    if (current?.streaming && !current.passive) {
      this.emit(payload.sessionId, {
        kind: "error",
        message: "A stream is already in progress for this session.",
      });
      return;
    }
    if (current?.passive && current.streaming) {
      // The local state below replaces the passive one, after which
      // `observePassiveFrame` drops every remaining frame of the host turn
      // — including its terminal event. Settle the host bubble here or it
      // spins forever.
      //
      // It has to NAME the bubble. By the time `submit()` runs, the surface
      // has already primed its accumulators for the LOCAL turn, so an
      // unnamed `aborted` would seal the brand-new local bubble as
      // `[stopped]` and reject the very turn being submitted. The host turn
      // itself is not cancelled — DSH queues the new prompt behind it and
      // the completed turn reappears in full on the next history read —
      // so the surface only stops the spinner rather than stamping
      // `[stopped]` onto text that is about to be superseded.
      this.emit(payload.sessionId, {
        kind: "aborted",
        ...(current.assistantUiId
          ? { assistantUiId: current.assistantUiId }
          : {}),
      });
      this.states.delete(payload.sessionId);
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
    this.approvalLedger.get(sessionId)?.delete(approvalId);
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

  async cancelQuestions(
    request: UserQuestionRequest,
  ): Promise<RuntimeActionResult> {
    const sessionId = request.sessionId;
    if (!sessionId) return { ok: false, error: "Question has no DSH session." };
    try {
      const receipt = await this.options.client.cancelQuestions(
        request.requestId,
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
    this.ensureInteractionWatcher();
    return () => this.streamListeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.watchController.abort();
    for (const state of this.states.values()) state.controller?.abort();
    this.states.clear();
    this.questionLedger.clear();
    this.approvalLedger.clear();
    this.snapshotListeners.clear();
    this.streamListeners.clear();
  }
}
