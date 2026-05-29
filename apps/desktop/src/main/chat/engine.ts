import {
  postHermesApprovalDecision,
  streamChat,
  type AssistantTimelineItem,
  type ChatRuntimeError,
  type ChatRuntimeState,
  type ClientToEngineMessage,
  type EngineToClientMessage,
  type HermesApprovalRequest,
  type HermesToolProgress,
  type SnapshotFrame,
  type StreamEvent,
  type StreamedToolCall,
  type SubmitPayload
} from "@hermes-x/core"
import { BrowserWindow, ipcMain } from "electron"

import { sendToNotifier } from "../notifier-window"

/**
 * Per-session running state. Mirrors the renderer's `ChatRuntimeState` so
 * a snapshot frame can rehydrate the UI without translation.
 */
interface SessionState extends ChatRuntimeState {
  controller?: AbortController
}

const sessions = new Map<string, SessionState>()
const subscribers = new Set<string>() // sessionIds the engine is currently streaming to

/**
 * Pending approvals indexed by approvalId so the Heads-up Notifier can
 * resolve them without knowing which session they came from. Cleared on
 * `approvalResolved` (gateway-initiated) or after the local POST settles.
 */
const pendingApprovalsById = new Map<
  string,
  { runId: string; sessionId: string }
>()

export async function resolveApproval(
  approvalId: string,
  verdict: "approve" | "deny"
): Promise<void> {
  const ref = pendingApprovalsById.get(approvalId)
  if (!ref) return
  pendingApprovalsById.delete(approvalId)
  const decision = verdict === "approve" ? "once" : "deny"
  const res = await postHermesApprovalDecision({
    runId: ref.runId,
    approvalId,
    decision
  })
  if (!res.ok) {
    console.warn("[notifier] approval decision POST failed:", res.error)
  }
  // Optimistically drop the card; the gateway will also emit
  // `approvalResolved` shortly, which is a safe no-op once the renderer
  // already cleared.
  sendToNotifier({ type: "dismiss", id: approvalId })
}

function broadcast(msg: EngineToClientMessage) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue
    win.webContents.send("chat:engine-to-client", msg)
  }
}

function emitEvent(sessionId: string, event: StreamEvent) {
  broadcast({ type: "event", sessionId, event })
}

function emitSnapshot(frame: SnapshotFrame) {
  broadcast(frame)
}

function makeInitialState(sessionId: string, assistantUiId: string): SessionState {
  const now = Date.now()
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
    updatedAt: now
  }
}

function snapshotFor(sessionId: string): SnapshotFrame {
  const st = sessions.get(sessionId)
  if (!st) return { type: "snapshot", sessionId, kind: "absent" }
  const pruned: ChatRuntimeState = { ...st }
  // Strip the AbortController — IPC can't serialize functions.
  delete (pruned as Partial<SessionState>).controller
  if (st.streaming) {
    return { type: "snapshot", sessionId, kind: "live", state: pruned }
  }
  if (st.error) {
    return { type: "snapshot", sessionId, kind: "interrupted", state: pruned }
  }
  return { type: "snapshot", sessionId, kind: "completed", state: pruned }
}

async function handleSubmit(payload: SubmitPayload) {
  const { sessionId, assistantUiId, model, history } = payload

  // Cancel any in-flight stream on this session before starting the new one.
  const prev = sessions.get(sessionId)
  prev?.controller?.abort()

  const state = makeInitialState(sessionId, assistantUiId)
  const controller = new AbortController()
  state.controller = controller
  sessions.set(sessionId, state)

  emitEvent(sessionId, { kind: "begin", assistantUiId })

  // Mark this text item as the in-flight assistant block so chunks have a
  // place to land in the timeline.
  function ensureLastTextItem(): AssistantTimelineItem & { kind: "text" } {
    const last = state.timeline[state.timeline.length - 1]
    if (last && last.kind === "text") return last
    const fresh = { kind: "text" as const, id: `t_${Date.now()}_${state.timeline.length}`, text: "" }
    state.timeline.push(fresh)
    return fresh
  }

  try {
    await streamChat(history, { model, sessionId, signal: controller.signal }, {
      onChunk: (delta) => {
        state.assistantText += delta
        const item = ensureLastTextItem()
        item.text += delta
        state.updatedAt = Date.now()
        emitEvent(sessionId, { kind: "chunk", text: delta })
      },
      onReasoningChunk: (delta) => {
        state.reasoning += delta
        state.updatedAt = Date.now()
        emitEvent(sessionId, { kind: "reasoning", text: delta })
      },
      onToolCallsState: (calls: StreamedToolCall[]) => {
        state.toolCalls = calls
        state.updatedAt = Date.now()
        emitEvent(sessionId, { kind: "toolCalls", calls })
      },
      onHermesToolProgress: (event: HermesToolProgress) => {
        const stamped: HermesToolProgress = {
          ...event,
          startedAt: event.status === "running" ? Date.now() : event.startedAt,
          durationMs:
            event.status === "completed"
              ? event.durationMs ??
                (() => {
                  const prior = state.hermesToolProgress.find(
                    (e) => e.toolCallId === event.toolCallId && e.status === "running"
                  )
                  return prior?.startedAt ? Date.now() - prior.startedAt : undefined
                })()
              : event.durationMs
        }
        const existingIdx = state.hermesToolProgress.findIndex(
          (e) => e.toolCallId === event.toolCallId
        )
        if (existingIdx >= 0) state.hermesToolProgress[existingIdx] = stamped
        else state.hermesToolProgress.push(stamped)
        if (!state.hermesOrder.includes(stamped.toolCallId)) {
          state.hermesOrder.push(stamped.toolCallId)
        }
        // Append a tool item to the timeline on the first sighting.
        if (stamped.status === "running" && existingIdx < 0) {
          state.timeline.push({
            kind: "tool",
            id: `tl_${Date.now()}_${state.timeline.length}`,
            toolCallId: stamped.toolCallId
          })
        }
        state.updatedAt = Date.now()
        emitEvent(sessionId, { kind: "hermesToolProgress", event: stamped })
      },
      onApprovalRequest: (request: HermesApprovalRequest) => {
        if (!state.pendingApprovals.find((p) => p.approvalId === request.approvalId)) {
          state.pendingApprovals.push(request)
          state.timeline.push({
            kind: "approval",
            id: `tl_${Date.now()}_${state.timeline.length}`,
            approvalId: request.approvalId
          })
        }
        emitEvent(sessionId, { kind: "approvalRequest", request })
      },
      onApprovalResolved: (approvalId: string) => {
        state.pendingApprovals = state.pendingApprovals.filter(
          (p) => p.approvalId !== approvalId
        )
        emitEvent(sessionId, { kind: "approvalResolved", approvalId })
      },
      onSession: (sid) => {
        emitEvent(sessionId, { kind: "session", sessionId: sid })
      },
      onRun: (runId) => {
        state.runId = runId
        emitEvent(sessionId, { kind: "run", runId })
      }
    })

    state.streaming = false
    state.updatedAt = Date.now()
    emitEvent(sessionId, { kind: "done" })
  } catch (err: unknown) {
    state.streaming = false
    state.updatedAt = Date.now()
    if ((err as { name?: string })?.name === "AbortError") {
      emitEvent(sessionId, { kind: "aborted" })
    } else {
      const e = err as { message?: string; status?: number; hint?: string }
      const error: ChatRuntimeError = {
        message: e?.message || String(err),
        status: e?.status,
        hint: e?.hint
      }
      state.error = error
      emitEvent(sessionId, { kind: "error", ...error })
    }
  } finally {
    if (state.controller === controller) delete state.controller
  }
}

function handleAbort(sessionId: string) {
  const st = sessions.get(sessionId)
  st?.controller?.abort()
}

function handleClear(sessionId: string) {
  const st = sessions.get(sessionId)
  st?.controller?.abort()
  sessions.delete(sessionId)
}

function handleClearApproval(sessionId: string, approvalId: string) {
  const st = sessions.get(sessionId)
  if (!st) return
  st.pendingApprovals = st.pendingApprovals.filter((p) => p.approvalId !== approvalId)
}

function handleClientMessage(msg: ClientToEngineMessage) {
  switch (msg.type) {
    case "subscribe":
      subscribers.add(msg.sessionId)
      emitSnapshot(snapshotFor(msg.sessionId))
      return
    case "snapshot":
      emitSnapshot(snapshotFor(msg.sessionId))
      return
    case "submit":
      void handleSubmit(msg.payload)
      return
    case "abort":
      handleAbort(msg.sessionId)
      return
    case "clear":
      handleClear(msg.sessionId)
      return
    case "clearApproval":
      handleClearApproval(msg.sessionId, msg.approvalId)
      return
  }
}

export function registerChatHandlers() {
  ipcMain.handle("chat:client-to-engine", (_e, msg: ClientToEngineMessage) => {
    handleClientMessage(msg)
  })
}
