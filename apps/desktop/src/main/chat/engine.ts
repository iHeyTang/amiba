import {
  ensureHermesSession,
  postHermesApprovalDecision,
  runHermesAgent,
  SOURCE_LOCAL,
  type AssistantTimelineItem,
  type ChatRuntimeState,
  type ClientToEngineMessage,
  type EngineToClientMessage,
  type HermesApprovalRequest,
  type HermesToolProgress,
  type SnapshotFrame,
  type StreamEvent,
  type SubmitPayload,
} from "@amiba/core";
import { BrowserWindow, ipcMain } from "electron";

import { getNotifierWindow, sendToNotifier } from "../notifier-window";
import { workspaceManager } from "../workspace";
import {
  buildApprovalPendingNotification,
  buildChatCompletedNotification,
  shouldNotifyForWindowState,
} from "./completion-notification";
import { toChatRuntimeError } from "./runtime-error";

/**
 * Per-session running state. Mirrors the renderer's `ChatRuntimeState` so
 * a snapshot frame can rehydrate the UI without translation.
 */
interface SessionState extends ChatRuntimeState {
  controller?: AbortController;
}

const sessions = new Map<string, SessionState>();
const subscribers = new Set<string>(); // sessionIds the engine is currently streaming to

/**
 * Pluggable sink for chat-engine events that the extension host
 * broadcasts to subscribed extension runners. Initialized by the
 * desktop boot path right after `bootMainExtensionHost` returns; left
 * as a no-op so unit tests that exercise the engine don't have to
 * stand up the extension host.
 */
let publishChatEvent: (event: string, payload: unknown) => void = () => {};

/**
 * Wire the engine to the extension host's broadcaster. Called once
 * from `apps/desktop/src/main/index.ts` after the host comes up;
 * subsequent calls overwrite (so hot-reload of the host during dev
 * doesn't strand stale references).
 */
export function setChatEventPublisher(
  fn: (event: string, payload: unknown) => void,
): void {
  publishChatEvent = fn;
}

/**
 * Pending approvals indexed by approvalId so the Heads-up Notifier can
 * resolve them without knowing which session they came from. Populated
 * when the chat engine first sees an approval request (along with the
 * sessionId + runId we need to POST the decision back). Cleared on
 * `approvalResolved` (gateway-initiated), `resolveApproval` (notifier
 * click), or on session abort/error.
 */
const pendingApprovalsById = new Map<
  string,
  {
    runId: string;
    sessionId: string;
    profileId?: string;
    request: HermesApprovalRequest;
  }
>();

function dropApprovalLocally(approvalId: string): void {
  pendingApprovalsById.delete(approvalId);
  sendToNotifier({ type: "dismiss", id: approvalId });
}

export async function resolveApproval(
  approvalId: string,
  verdict: "approve" | "deny",
): Promise<void> {
  const ref = pendingApprovalsById.get(approvalId);
  if (!ref) return;
  pendingApprovalsById.delete(approvalId);
  const decision = verdict === "approve" ? "once" : "deny";
  const res = await postHermesApprovalDecision({
    runId: ref.runId,
    approvalId,
    decision,
    profileId: ref.profileId,
  });
  if (!res.ok) {
    console.warn("[notifier] approval decision POST failed:", res.error);
  }
  // Optimistically drop the card; the gateway will also emit
  // `approvalResolved` shortly, which is a safe no-op once the renderer
  // already cleared. Also mirror the verdict into the main chat panel so
  // both surfaces converge on the same state — the renderer's own
  // approval bubble would otherwise sit forever.
  sendToNotifier({ type: "dismiss", id: approvalId });
  const st = sessions.get(ref.sessionId);
  if (st) {
    st.pendingApprovals = st.pendingApprovals.filter(
      (p) => p.approvalId !== approvalId,
    );
    emitEvent(ref.sessionId, { kind: "approvalResolved", approvalId });
  }
}

function shouldSuppressNotifier(): boolean {
  // When the user is staring at a real (focusable) Amiba window, the
  // in-panel approval bubble is already visible — surfacing a second
  // floating card on top would be noise. Exclude the notifier itself:
  // it becomes focused after a deliberate click and must not suppress
  // a newer approval that arrives while the user is acting on it.
  const notifier = getNotifierWindow();
  return !shouldNotifyForWindowState(BrowserWindow.getAllWindows(), notifier);
}

function broadcast(msg: EngineToClientMessage) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue;
    win.webContents.send("chat:engine-to-client", msg);
  }
}

function emitEvent(sessionId: string, event: StreamEvent) {
  broadcast({ type: "event", sessionId, event });
}

function emitSnapshot(frame: SnapshotFrame) {
  broadcast(frame);
}

function makeInitialState(
  sessionId: string,
  assistantUiId: string,
): SessionState {
  const now = Date.now();
  return {
    sessionId,
    assistantUiId,
    streaming: true,
    assistantText: "",
    reasoning: "",
    toolCalls: [],
    hermesOrder: [],
    hermesToolProgress: [],
    timeline: [],
    error: null,
    agentFinalUrl: null,
    agentFinalTitle: null,
    pendingApprovals: [],
    runId: null,
    startedAt: now,
    updatedAt: now,
  };
}

function snapshotFor(sessionId: string): SnapshotFrame {
  const st = sessions.get(sessionId);
  if (!st) return { type: "snapshot", sessionId, kind: "absent" };
  const pruned: ChatRuntimeState = { ...st };
  // Strip the AbortController — IPC can't serialize functions.
  delete (pruned as Partial<SessionState>).controller;
  if (st.streaming) {
    return { type: "snapshot", sessionId, kind: "live", state: pruned };
  }
  if (st.error) {
    return { type: "snapshot", sessionId, kind: "interrupted", state: pruned };
  }
  return { type: "snapshot", sessionId, kind: "completed", state: pruned };
}

async function handleSubmit(payload: SubmitPayload) {
  const { sessionId, sessionTitle, assistantUiId, model, history, agent } =
    payload;

  // Make sure the SessionDB row exists with the correct ``source`` BEFORE
  // ``runHermesAgent`` opens the run. Otherwise the first ``/v1/runs`` for a
  // never-seen sessionId triggers api_server's fallback path which
  // auto-creates the row tagged ``source="api_server"`` — that's how
  // Quick-Ask sessions ended up in the wrong channel before this fix.
  // ``ensureHermesSession`` is INSERT-OR-IGNORE and caches per-process so
  // the cost is one round-trip per new id over the lifetime of the main
  // process.
  //
  // Every local amiba submit — main window, Quick-Ask, and the
  // extension — writes the same canonical "local" source; the optional
  // ``source`` on SubmitPayload is a future-proofing hook for surfaces
  // that genuinely warrant their own channel, not used today.
  try {
    await ensureHermesSession(
      sessionId,
      payload.source ?? SOURCE_LOCAL,
      undefined,
      agent?.profileId,
    );
  } catch (err) {
    // This preflight runs before the per-turn state is created, but the
    // renderer has already optimistically entered its busy state. Always send
    // a clone-safe terminal event so a Backplane outage cannot strand it.
    emitEvent(sessionId, { kind: "error", ...toChatRuntimeError(err) });
    return;
  }

  // Cancel any in-flight stream on this session before starting the new one.
  const prev = sessions.get(sessionId);
  prev?.controller?.abort();

  // A new turn means any prior approvals from this session are stale —
  // either resolved or about to be re-requested. Drop them from the
  // out-of-session lookup so notifier "Allow/Deny" clicks can't POST to a
  // dead runId.
  if (prev) {
    for (const p of prev.pendingApprovals) {
      dropApprovalLocally(p.approvalId);
    }
  }

  // Inject the bound workspace path as a system-context block on the
  // user's most recent message. The structured cwd below is authoritative
  // for tools; this user-visible context keeps the active directory explicit
  // when an existing conversation switches workspaces while its persisted
  // system prompt remains byte-stable. We mutate a shallow copy so the
  // renderer's persisted history stays untouched.
  const augmentedHistory = injectWorkspaceContext(history, sessionId);
  const workingDirectory =
    workspaceManager.getForSession(sessionId) ?? undefined;

  const state = makeInitialState(sessionId, assistantUiId);
  const controller = new AbortController();
  state.controller = controller;
  sessions.set(sessionId, state);

  emitEvent(sessionId, { kind: "begin", assistantUiId });

  // Mark this text item as the in-flight assistant block so chunks have a
  // place to land in the timeline.
  function ensureLastTextItem(): AssistantTimelineItem & { kind: "text" } {
    const last = state.timeline[state.timeline.length - 1];
    if (last && last.kind === "text") return last;
    const fresh = {
      kind: "text" as const,
      id: `t_${Date.now()}_${state.timeline.length}`,
      text: "",
    };
    state.timeline.push(fresh);
    return fresh;
  }

  // Current gateways provide a stable tool_call_id plus structured args and
  // results. Keep the FIFO fallback for older Hermes installations whose
  // /v1/runs events only carried a tool name.
  let toolSeq = 0;
  const runningToolIds = new Map<string, string[]>();

  function applyToolProgress(event: HermesToolProgress) {
    const prior = state.hermesToolProgress.find(
      (e) => e.toolCallId === event.toolCallId,
    );
    const startedAt =
      event.status === "running"
        ? Date.now()
        : (event.startedAt ?? prior?.startedAt);
    const durationMs =
      event.status === "completed"
        ? (event.durationMs ?? (startedAt ? Date.now() - startedAt : undefined))
        : event.durationMs;
    const stamped: HermesToolProgress = {
      ...(prior ?? {}),
      ...event,
      label: event.label ?? prior?.label,
      args: event.args ?? prior?.args,
      result: event.result ?? prior?.result,
      error: event.error ?? prior?.error,
      inlineDiff: event.inlineDiff ?? prior?.inlineDiff,
      startedAt,
      durationMs,
    };

    const existingIdx = state.hermesToolProgress.findIndex(
      (e) => e.toolCallId === event.toolCallId,
    );
    if (existingIdx >= 0) state.hermesToolProgress[existingIdx] = stamped;
    else state.hermesToolProgress.push(stamped);
    if (!state.hermesOrder.includes(stamped.toolCallId)) {
      state.hermesOrder.push(stamped.toolCallId);
    }
    // Append a tool item to the timeline on the first sighting.
    if (stamped.status === "running" && existingIdx < 0) {
      state.timeline.push({
        kind: "tool",
        id: `tl_${Date.now()}_${state.timeline.length}`,
        toolCallId: stamped.toolCallId,
      });
    }
    state.updatedAt = Date.now();
    emitEvent(sessionId, { kind: "hermesToolProgress", event: stamped });

    // Fan out to extension runners via host.chat.onEvent, splitting
    // running/completed into two event names so subscribers don't branch on
    // status. runId comes from session state (hermes-agent's tool events
    // don't carry it) — the same runId captured from POST /v1/runs.
    if (stamped.status === "running") {
      publishChatEvent("tool.started", {
        sessionId,
        runId: state.runId,
        tool: stamped.tool,
        toolCallId: stamped.toolCallId,
        startedAt: stamped.startedAt,
        label: stamped.label,
        emoji: stamped.emoji,
      });
    } else if (stamped.status === "completed") {
      publishChatEvent("tool.completed", {
        sessionId,
        runId: state.runId,
        tool: stamped.tool,
        toolCallId: stamped.toolCallId,
        startedAt: stamped.startedAt,
        durationMs: stamped.durationMs,
        label: stamped.label,
        emoji: stamped.emoji,
      });
    }
  }

  try {
    // Drive the turn through the `/v1/runs` surface (not `/v1/chat/
    // completions`): only the runs surface registers the server-side
    // approval callback, so dangerous-command / execute_code prompts can
    // actually surface to the user instead of dead-ending as an
    // unactionable "Asking the user for approval" error (see
    // packages/core/src/hermes-client.ts and hermes-agent
    // api_server.py:_handle_runs / tools/approval.py).
    await runHermesAgent(
      augmentedHistory,
      {
        model,
        sessionId,
        agent,
        workingDirectory,
        signal: controller.signal,
        onRun: (runId) => {
          state.runId = runId;
          emitEvent(sessionId, { kind: "run", runId });
          // The runs surface keys continuity off the session_id we POSTed,
          // so echo it back for parity with the old X-Hermes-Session-Id
          // header path the renderer reconciles against.
          emitEvent(sessionId, { kind: "session", sessionId });
        },
      },
      {
        onMessageDelta: (delta) => {
          state.assistantText += delta;
          const item = ensureLastTextItem();
          item.text += delta;
          state.updatedAt = Date.now();
          emitEvent(sessionId, { kind: "chunk", text: delta });
        },
        onReasoning: (text) => {
          // Hermes historically used reasoning.available for both genuine
          // intermediate notes and a copy of the final answer. Treat it as
          // ephemeral progress, and drop the latter before it can flash twice.
          const trimmed = text.trim();
          if (!trimmed) return;
          const probe = trimmed.slice(0, 100);
          if (probe && state.assistantText.includes(probe)) return;
          state.reasoning = trimmed;
          state.updatedAt = Date.now();
          emitEvent(sessionId, { kind: "reasoning", text: trimmed });
        },
        onMoaEvent: (event) => {
          let progress = "";
          if (event.kind === "progress") {
            const count =
              event.refsTotal > 0
                ? `${event.refsDone}/${event.refsTotal}`
                : `${event.refsDone}`;
            progress = ["MoA", count, event.label].filter(Boolean).join(" · ");
          } else if (
            event.kind === "aggregating" ||
            (event.kind === "phase" && event.phase === "aggregator")
          ) {
            progress = ["MoA", "→", event.aggregator]
              .filter(Boolean)
              .join(" · ");
          }
          // Individual reference payloads remain available through
          // RunHandlers for richer consumers, but the chat keeps this
          // transient status deliberately compact.
          if (!progress || progress === state.reasoning) return;
          state.reasoning = progress;
          state.updatedAt = Date.now();
          emitEvent(sessionId, { kind: "reasoning", text: progress });
        },
        onToolStarted: ({ tool, toolCallId: stableId, preview, args }) => {
          const toolCallId =
            stableId ?? `rt_${state.runId ?? sessionId}_${toolSeq++}`;
          const queue = runningToolIds.get(tool) ?? [];
          queue.push(toolCallId);
          runningToolIds.set(tool, queue);
          applyToolProgress({
            tool,
            toolCallId,
            status: "running",
            label: preview || undefined,
            args,
          });
        },
        onToolCompleted: ({
          tool,
          toolCallId: stableId,
          duration,
          error,
          args,
          result,
          inlineDiff,
        }) => {
          const queue = runningToolIds.get(tool);
          const toolCallId =
            stableId ??
            (queue && queue.length
              ? queue.shift()!
              : `rt_${state.runId ?? sessionId}_${toolSeq++}`);
          if (stableId && queue) {
            const index = queue.indexOf(stableId);
            if (index >= 0) queue.splice(index, 1);
          }
          if (queue && queue.length === 0) runningToolIds.delete(tool);
          applyToolProgress({
            tool,
            toolCallId,
            status: "completed",
            args,
            result,
            error,
            inlineDiff,
            durationMs:
              typeof duration === "number"
                ? Math.round(duration * 1000)
                : undefined,
          });
        },
        onApprovalRequest: (request: HermesApprovalRequest) => {
          const seen = state.pendingApprovals.some(
            (p) => p.approvalId === request.approvalId,
          );
          if (!seen) {
            state.pendingApprovals.push(request);
            state.timeline.push({
              kind: "approval",
              id: `tl_${Date.now()}_${state.timeline.length}`,
              approvalId: request.approvalId,
            });
          }
          // Track the request so the Heads-up Notifier (and any other
          // out-of-session decision surface) can POST a verdict back
          // without re-reading per-session state. The runId comes from the
          // request itself (the runs surface always sets it); we fall back
          // to whatever the session most recently observed.
          const runId = request.runId || state.runId || "";
          if (runId) {
            pendingApprovalsById.set(request.approvalId, {
              runId,
              sessionId,
              profileId: agent?.profileId,
              request,
            });
          }
          // Push to the Heads-up Notifier so users with the main window
          // backgrounded see the request immediately. Suppressed when the
          // main window is already focused — the in-panel approval bubble
          // takes precedence then.
          if (!seen && !shouldSuppressNotifier()) {
            sendToNotifier(
              buildApprovalPendingNotification({
                approvalId: request.approvalId,
                sessionId,
                sessionTitle,
                history,
                tool: request.tool,
                command: request.command,
                message: request.description || request.reason || "",
                timestamp: Date.now(),
              }),
            );
          }
          emitEvent(sessionId, { kind: "approvalRequest", request });
        },
        onApprovalResponded: () => {
          // The runs surface's `approval.responded` carries the choice and a
          // resolved-count but no approvalId, so reconcile FIFO: settle the
          // oldest still-pending approval for this session. (The user's own
          // click already dropped it optimistically via resolveApproval /
          // clearApproval, so this is usually a confirming no-op.)
          const next = state.pendingApprovals[0];
          if (!next) return;
          const approvalId = next.approvalId;
          state.pendingApprovals = state.pendingApprovals.filter(
            (p) => p.approvalId !== approvalId,
          );
          dropApprovalLocally(approvalId);
          emitEvent(sessionId, { kind: "approvalResolved", approvalId });
        },
        onRunCompleted: ({ usage }) => {
          // Fan out token usage to extension runners (parity with the old
          // onUsage path). Runs reports input/output/total; the
          // run.completed extension event expects the OpenAI-standard
          // prompt/completion/total triple.
          if (usage) {
            publishChatEvent("run.completed", {
              sessionId,
              model,
              usage: {
                prompt_tokens: usage.input_tokens ?? 0,
                completion_tokens: usage.output_tokens ?? 0,
                total_tokens: usage.total_tokens ?? 0,
              },
            });
          }
        },
      },
    );

    state.streaming = false;
    state.updatedAt = Date.now();
    emitEvent(sessionId, { kind: "done" });
    if (!shouldSuppressNotifier()) {
      sendToNotifier(
        buildChatCompletedNotification({
          sessionId,
          assistantUiId,
          history,
          assistantText: state.assistantText,
          timestamp: state.updatedAt,
        }),
      );
    }
  } catch (err: unknown) {
    state.streaming = false;
    state.updatedAt = Date.now();
    if ((err as { name?: string })?.name === "AbortError") {
      emitEvent(sessionId, { kind: "aborted" });
    } else {
      const error = toChatRuntimeError(err);
      state.error = error;
      emitEvent(sessionId, { kind: "error", ...error });
    }
  } finally {
    if (state.controller === controller) delete state.controller;
  }
}

function handleAbort(sessionId: string) {
  const st = sessions.get(sessionId);
  st?.controller?.abort();
  // An aborted turn's pending approvals are unreachable (the gateway
  // closed the SSE stream) — clear them from the out-of-session lookup
  // so notifier clicks can't POST to a dead runId.
  if (st) {
    for (const p of st.pendingApprovals) dropApprovalLocally(p.approvalId);
  }
}

function handleClear(sessionId: string) {
  const st = sessions.get(sessionId);
  st?.controller?.abort();
  if (st) {
    for (const p of st.pendingApprovals) dropApprovalLocally(p.approvalId);
  }
  sessions.delete(sessionId);
}

function handleClearApproval(sessionId: string, approvalId: string) {
  const st = sessions.get(sessionId);
  if (!st) return;
  st.pendingApprovals = st.pendingApprovals.filter(
    (p) => p.approvalId !== approvalId,
  );
  dropApprovalLocally(approvalId);
}

/**
 * Prepend a `<workspace>` block to the latest user message when a
 * directory is bound for this session. The block is plain text so the
 * agent's existing tools (cd-aware shell, list_directory, read_file, …)
 * pick up the cwd without protocol changes. We touch only the FINAL user
 * turn so the surface contract stays "as if the user typed it".
 */
function injectWorkspaceContext(
  history: SubmitPayload["history"],
  sessionId: string,
): SubmitPayload["history"] {
  const path = workspaceManager.getForSession(sessionId);
  if (!path) return history;
  // Find the LAST user message; engine submit always ends with one.
  let lastUserIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return history;
  const block = [
    "<workspace>",
    `Bound directory: ${path}`,
    "Treat this as the working directory for filesystem tools (read_file,",
    "list_directory, shell, etc). Avoid touching files outside this tree",
    "unless the user explicitly asks. Paths in your output should be",
    "relative to this directory when convenient.",
    "</workspace>",
    "",
  ].join("\n");
  const next = history.slice();
  const prev = next[lastUserIdx];
  const content = typeof prev.content === "string" ? prev.content : "";
  next[lastUserIdx] = { ...prev, content: `${block}${content}` };
  return next;
}

function handleClientMessage(msg: ClientToEngineMessage) {
  switch (msg.type) {
    case "subscribe":
      subscribers.add(msg.sessionId);
      emitSnapshot(snapshotFor(msg.sessionId));
      return;
    case "snapshot":
      emitSnapshot(snapshotFor(msg.sessionId));
      return;
    case "submit":
      void handleSubmit(msg.payload);
      return;
    case "abort":
      handleAbort(msg.sessionId);
      return;
    case "clear":
      handleClear(msg.sessionId);
      return;
    case "clearApproval":
      handleClearApproval(msg.sessionId, msg.approvalId);
      return;
  }
}

export function registerChatHandlers() {
  ipcMain.handle("chat:client-to-engine", (_e, msg: ClientToEngineMessage) => {
    handleClientMessage(msg);
  });
}
