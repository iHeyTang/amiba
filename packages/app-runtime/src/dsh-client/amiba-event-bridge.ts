import { TurnTokenUsage } from "./turn-token-usage"
import { retryProgress } from "./retry"
import { compactionUpdate } from "./compaction.js"
import { ClosingAssistant } from "./closing-assistant"
import { CodeDispatchTree } from "./code-dispatch-tree"
import type {
  ApprovalOutcome,
  StreamEvent,
  ToolProgress,
} from "@amiba/app-runtime/protocol"
import type { DshMuxEnvelope, DshSessionEvent } from "./index"
import { toolCallWireRecord, toolResultWireRecord } from "./tool-wire"
import {
  presentationNotice,
  userMessageText,
  userMessageUiId,
  visibleUserMessage,
} from "./user-message-source"

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function textOfContent(value: unknown): string {
  if (!Array.isArray(value)) return ""
  return value
    .map((block) => {
      const item = record(block)
      if (item?.type === "text" && typeof item.text === "string") {
        return item.text
      }
      // Tool results nest their payload one level down:
      // { type: "tool-result", toolCallId, content: [{ type: "text", … }] }
      if (item?.type === "tool-result") return textOfContent(item.content)
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

/** Resolve a tool result's call id from the real DSH wire shape. */
function toolResultCallId(message: Record<string, unknown> | null): string {
  if (typeof message?.toolCallId === "string") return message.toolCallId
  const source = record(message?.source)
  if (typeof source?.callId === "string") return source.callId
  if (Array.isArray(message?.content)) {
    for (const block of message.content) {
      const item = record(block)
      if (item?.type === "tool-result" && typeof item.toolCallId === "string") {
        return item.toolCallId
      }
    }
  }
  return ""
}

function titleFromView(value: unknown): string | undefined {
  const wrapper = record(value)
  const view = record(wrapper?.view)
  return typeof view?.title === "string" ? view.title : undefined
}

function approvalOutcome(
  value: "allowed-once" | "rejected" | "cancelled" | "unavailable",
): ApprovalOutcome {
  if (value === "allowed-once") return "once"
  if (value === "rejected") return "deny"
  return value
}

export interface BridgedDshEvent {
  sessionId: string
  event: StreamEvent
  /** Final approval outcome is useful for persisted audit records. */
  approvalOutcome?: ApprovalOutcome
}

/** Stateful projection from native DSH mux frames to Amiba's UI protocol. */
export class DshAmibaEventBridge {
  private readonly toolsBySession = new Map<string, Map<string, ToolProgress>>()
  private readonly usage = new Map<string, TurnTokenUsage>()
  private readonly closingAssistants = new Map<string, ClosingAssistant>()
  private readonly dispatches = new Map<string, CodeDispatchTree>()

  accept(envelope: DshMuxEnvelope): BridgedDshEvent[] {
    const frame = envelope.payload
    switch (frame.type) {
      case "session/event":
        return this.sessionEvent(frame.sessionId, frame.event, frame.view)
      case "approval/requested":
        return [
          {
            sessionId: frame.sessionId,
            event: {
              kind: "approvalRequest",
              request: {
                requestId: envelope.rpcId,
                approvalId: frame.approvalId,
                sessionId: frame.sessionId,
                tool: frame.toolName,
                toolCallId: frame.callId,
                reason: frame.reason,
                raw: frame as unknown as Record<string, unknown>,
              },
            },
          },
        ]
      case "approval/resolved":
        return [
          {
            sessionId: frame.sessionId,
            event: { kind: "approvalResolved", approvalId: frame.approvalId },
            approvalOutcome: approvalOutcome(frame.outcome),
          },
        ]
      case "question/requested":
        return [
          {
            sessionId: frame.sessionId,
            event: {
              kind: "questionRequest",
              request: {
                requestId: envelope.rpcId,
                sessionId: frame.sessionId,
                questions: frame.questions,
                raw: frame as unknown as Record<string, unknown>,
              },
            },
          },
        ]
      case "question/resolved":
        return [
          {
            sessionId: frame.sessionId,
            event: {
              kind: "questionResolved",
              requestId: frame.questionRpcId,
            },
          },
        ]
      case "session/projection":
        // The runtime's session-title projection (dsh-session-title): the
        // auto-generated title for a session, broadcast on change.
        if (
          frame.key === "title" &&
          typeof frame.value === "string" &&
          frame.value.trim()
        ) {
          return [
            {
              sessionId: frame.sessionId,
              event: { kind: "sessionTitle", title: frame.value },
            },
          ]
        }
        return []
      default:
        return []
    }
  }

  private sessionEvent(sessionId: string, source: DshSessionEvent, view: unknown): BridgedDshEvent[] {
    let closing = this.closingAssistants.get(sessionId)
    if (!closing) { closing = new ClosingAssistant(); this.closingAssistants.set(sessionId, closing) }
    closing.apply(source)
    let usage = this.usage.get(sessionId)
    if (!usage) { usage = new TurnTokenUsage(); this.usage.set(sessionId, usage) }
    usage.apply(source)
    const frames = this.projectSessionEvent(sessionId, source, view)
    const messageId = source.type === "turn/end" ? closing.getMessageId() : null
    return messageId === null ? frames : [{ sessionId, event: { kind: "assistantMessage", messageId, sentAt: source.time, ...(usage.snapshot() ? { tokenUsage: usage.snapshot() } : {}) } }, ...frames]
  }

  private projectSessionEvent(
    sessionId: string,
    source: DshSessionEvent,
    view: unknown,
  ): BridgedDshEvent[] {
    let tools = this.toolsBySession.get(sessionId)
    if (!tools) { tools = new Map(); this.toolsBySession.set(sessionId, tools) }
    const compact = compactionUpdate(source)
    if (compact) return [{ sessionId, event: { kind: "compaction", event: compact } }]
    const data = source.data
    if (source.type === "amiba/notice") {
      const notice = presentationNotice(data)
      return notice ? [{ sessionId, event: { kind: "userMessage", ...notice, sentAt: source.time } }] : []
    }
    if (source.type === "user/message") {
      // Only a PLUGIN-dispatched message becomes a live event. The person's
      // own message is already on screen — the composer appends its bubble
      // before it submits — and echoing it would land a second bubble under
      // a different id, so a source with no `origin` produces nothing here.
      // Everything else about the mapping (which forms count, whether the
      // message is a turn or an account, the words, the `uiId`) comes from
      // the same module the durable-log projection reads, so the live bubble
      // and the reloaded one are one message.
      const visible = visibleUserMessage(data.source)
      if (!visible?.origin) return []
      const { text, images, badges, attachments } = userMessageText(data.content)
      return [
        {
          sessionId,
          event: {
            kind: "userMessage",
            uiId: userMessageUiId(data.id, source.seq),
            content: text,
            ...(images.length ? { images } : {}),
            ...(attachments.length ? { attachments } : {}),
            ...(badges.length ? { attachmentBadges: badges } : {}),
            sentAt: source.time,
            origin: visible.origin,
            ...(visible.notice ? { notice: visible.notice } : {}),
          },
        },
      ]
    }
    if (source.type === "turn/start") {
      // A new turn begins: the previous turn's tool records are dead (the
      // code-dispatch tree is reset below), and each ToolProgress record
      // carries full args/results. Without this, a long-lived window kept
      // every tool call of every turn it ever followed in memory. In the
      // normal wire order (tool/result → turn/end → turn/start) nothing from
      // the finished turn is still needed; a straggler result after a brand
      // new turn/start is as degraded as a cold reconnect (progress without
      // the prior call's args) — acceptable, and the UI renders its own live
      // state regardless.
      tools.clear();
      this.closingAssistants.delete(sessionId);
      this.usage.delete(sessionId);
      this.dispatches.set(sessionId, new CodeDispatchTree())
      const turn = typeof data.turn === "number" ? data.turn : source.seq
      return [{ sessionId, event: { kind: "turn", turnId: `${sessionId}:${turn}`, ...(Number.isSafeInteger(data.turn) && (data.turn as number) >= 0 ? { runtimeTurn: data.turn as number } : {}) } }]
    }
    const runtimeStep = Number.isSafeInteger(data.step) && (data.step as number) >= 0 ? data.step as number : undefined
    const retry = retryProgress(source)
    if (retry) {
      return [
        ...(source.type === "llm/retry" && runtimeStep !== undefined ? [{sessionId,event:{kind:"assistantTextSource" as const,phase:"reset" as const,runtimeStep}}] : []),
        {sessionId,event:{kind:"retry",event:retry}},
      ]
    }
    if (source.type === "llm/retry" && runtimeStep !== undefined) return [{sessionId,event:{kind:"assistantTextSource",phase:"reset",runtimeStep}}]
    if (source.type === "assistant/message" && source.surfaceOp === "append" && runtimeStep !== undefined) {
      const content = record(data.message)?.content
      const text = Array.isArray(content) ? content.map(block => {
        const value = record(block)
        return value?.type === "text" && typeof value.text === "string" ? value.text : ""
      }).join("") : ""
      return [{sessionId,event:{kind:"assistantTextSource",phase:"final",runtimeStep,runtimeSeq:source.seq,text}}]
    }
    if (source.type === "assistant/chunk") {
      const chunk = record(data.chunk)
      if (
        (chunk?.type === "text-delta" || chunk?.type === "reasoning-delta") &&
        typeof chunk.text === "string" &&
        chunk.text
      ) {
        return [
          {
            sessionId,
            event:
              chunk.type === "text-delta"
                ? { kind: "chunk", text: chunk.text, ...(runtimeStep === undefined ? {} : {runtimeStep}) }
                : { kind: "reasoning", text: chunk.text },
          },
        ]
      }
      return []
    }
    if (source.type === "tool/code-dispatch-start" || source.type === "tool/code-dispatch") {
      let tree = this.dispatches.get(sessionId)
      if (!tree) { tree = new CodeDispatchTree(); this.dispatches.set(sessionId, tree) }
      const root = tree.apply(source)
      const prior = root === null ? undefined : tools.get(root)
      if (!prior) return []
      const progress = tree.project(prior)
      tools.set(progress.toolCallId, progress)
      return [{ sessionId, event: { kind: "toolProgress", event: progress } }]
    }
    if (source.type === "tool/call") {
      const callId = typeof data.callId === "string" ? data.callId : ""
      const tool = typeof data.name === "string" ? data.name : "tool"
      if (!callId) return []
      const rawArgs = typeof data.arguments === "string" ? data.arguments : ""
      let args: Record<string, unknown> | undefined
      try {
        const parsed = JSON.parse(rawArgs) as unknown
        args = record(parsed) ?? undefined
      } catch {
        args = rawArgs ? { raw: rawArgs } : undefined
      }
      const progress: ToolProgress = {
        tool,
        toolCallId: callId,
        status: "running",
        label: titleFromView(view),
        args,
        startedAt: source.time,
        // Same lossless retention as the durable-log projection: the parsed
        // `args` above is unchanged, the raw wire material rides beside it.
        wire: { call: toolCallWireRecord(data, source.time, view) },
      }
      const projected = this.dispatches.get(sessionId)?.project(progress) ?? progress
      tools.set(callId, projected)
      return [{ sessionId, event: { kind: "toolProgress", event: projected } }]
    }
    if (source.type === "tool/result") {
      const message = record(data.message)
      const callId = toolResultCallId(message)
      if (!callId) return []
      const prior = tools.get(callId)
      const progress: ToolProgress = {
        tool: prior?.tool ?? "tool",
        toolCallId: callId,
        status: "completed",
        label: titleFromView(view) ?? prior?.label,
        args: prior?.args,
        result: {
          text: textOfContent(message?.content),
          view,
          meta: data.meta,
        },
        error: Boolean(message?.isError || data.error),
        startedAt: prior?.startedAt,
        durationMs:
          prior?.startedAt && source.time >= prior.startedAt
            ? source.time - prior.startedAt
            : undefined,
        // The call half carries forward from the running record; a result
        // arriving without one (reconnect mid-call) keeps `call` absent rather
        // than inventing arguments for it.
        wire: {
          ...(prior?.wire?.call ? { call: prior.wire.call } : {}),
          result: toolResultWireRecord(data, source.seq, source.time, view),
        },
      }
      const projected = this.dispatches.get(sessionId)?.project(progress) ?? progress
      tools.set(callId, projected)
      return [{ sessionId, event: { kind: "toolProgress", event: projected } }]
    }
    if (source.type === "turn/end") {
      const reason = record(data.reason)
      if (reason?.kind === "aborted") {
        return [{ sessionId, event: { kind: "aborted" } }]
      }
      if (reason?.kind === "error") {
        const failure = record(reason.error)
        return [
          {
            sessionId,
            event: {
              kind: "error",
              message:
                typeof failure?.message === "string"
                  ? failure.message
                  : "DSH turn failed.",
            },
          },
        ]
      }
      return [{ sessionId, event: { kind: "done" } }]
    }
    return []
  }
}
