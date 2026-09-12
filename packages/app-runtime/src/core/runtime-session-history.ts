import { compactionUpdate, upsertCompactionTimeline, interruptOpenCompactions } from "../dsh-client/compaction";
import type { AssistantTimelineItem } from "../protocol";
import type {
  AgentSessionHistoryEntry,
  AgentSessionEvent,
} from "@amiba/app-runtime/platform";

import {
  toolCallWireRecord,
  toolResultWireRecord,
} from "../dsh-client/tool-wire";
import {
  presentationNotice,
  userMessageText,
  userMessageUiId,
  visibleUserMessage,
} from "../dsh-client/user-message-source";
import type { ToolProgress } from "./runtime-protocol";
import type { SessionMessage } from "./sessions";

import type { AttachmentBadge } from "./attachments/types";

type RuntimeSessionMessage = SessionMessage & {
  /** Wall-clock time of the durable event that produced this message. */
  sentAt?: number;
  reasoning?: string;
  /** Rebuilt from the message's `<file-attachment>` envelope on reload. */
  attachmentBadges?: AttachmentBadge[];
  /** Wall-clock duration of the reasoning stream, from durable event times. */
  reasoningMs?: number;
  /** Wall-clock span of the process phase, from durable event times. */
  processMs?: number;
  toolProgress?: ToolProgress[];
  assistantTimeline?: AssistantTimelineItem[];
  runtimeSeq?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      const item = record(block);
      if (item?.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      // Tool results nest their payload one level down:
      // { type: "tool-result", toolCallId, content: [{ type: "text", … }] }
      if (item?.type === "tool-result") return contentText(item.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}


/**
 * Resolve a tool result's call id from the real DSH wire shape
 * (`message.source.callId`, mirrored on the tool-result content block),
 * falling back to the flat `message.toolCallId` used by older logs.
 */
function toolResultCallId(message: Record<string, unknown> | null): string {
  if (typeof message?.toolCallId === "string") return message.toolCallId;
  const source = record(message?.source);
  if (typeof source?.callId === "string") return source.callId;
  if (Array.isArray(message?.content)) {
    for (const block of message.content) {
      const item = record(block);
      if (item?.type === "tool-result" && typeof item.toolCallId === "string") {
        return item.toolCallId;
      }
    }
  }
  return "";
}

function messageFromEvent(event: AgentSessionEvent): Record<string, unknown> | null {
  if (event.type === "user/message") return record(event.data);
  if (event.type === "assistant/message") return record(event.data.message);
  return null;
}

interface AssistantTurn {
  turn: number;
  firstSeq: number;
  text: string;
  draftText: string;
  reasoning: string;
  reasoningStartAt: number | null;
  reasoningEndAt: number | null;
  processFirstAt: number | null;
  processLastAt: number | null;
  tools: Map<string, ToolProgress>;
  timeline: RuntimeSessionMessage["assistantTimeline"];
}

function beginTurn(event: AgentSessionEvent): AssistantTurn {
  return {
    turn:
      typeof event.data.turn === "number" ? event.data.turn : event.seq,
    firstSeq: event.seq,
    text: "",
    draftText: "",
    reasoning: "",
    reasoningStartAt: null,
    reasoningEndAt: null,
    processFirstAt: null,
    processLastAt: null,
    tools: new Map(),
    timeline: [],
  };
}

function markProcessActivity(turn: AssistantTurn, time: number): void {
  if (turn.processFirstAt === null) turn.processFirstAt = time;
  turn.processLastAt = time;
}

function finishTurn(
  turn: AssistantTurn | null,
  output: RuntimeSessionMessage[],
): void {
  if (!turn) return;
  const content = turn.text || turn.draftText;
  const tools = [...turn.tools.values()];
  if (!content && !turn.reasoning && tools.length === 0 && !turn.timeline?.length) return;
  const reasoningMs =
    turn.reasoningStartAt !== null && turn.reasoningEndAt !== null
      ? Math.max(0, turn.reasoningEndAt - turn.reasoningStartAt)
      : undefined;
  const processMs =
    turn.processFirstAt !== null && turn.processLastAt !== null
      ? Math.max(0, turn.processLastAt - turn.processFirstAt)
      : undefined;
  output.push({
    role: "assistant",
    content,
    uiId: `dsh:turn:${turn.firstSeq}`,
    runtimeSeq: turn.firstSeq,
    ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
    ...(turn.reasoning && reasoningMs !== undefined ? { reasoningMs } : {}),
    ...(processMs !== undefined ? { processMs } : {}),
    ...(tools.length ? { toolProgress: tools } : {}),
    ...(turn.timeline?.length ? { assistantTimeline: turn.timeline } : {}),
  });
}

function applyToolCall(turn: AssistantTurn, entry: AgentSessionHistoryEntry): void {
  const data = entry.event.data;
  const callId = typeof data.callId === "string" ? data.callId : "";
  if (!callId) return;
  const rawArgs = typeof data.arguments === "string" ? data.arguments : "";
  let args: Record<string, unknown> | undefined;
  try {
    args = record(JSON.parse(rawArgs)) ?? undefined;
  } catch {
    args = rawArgs ? { raw: rawArgs } : undefined;
  }
  turn.tools.set(callId, {
    tool: typeof data.name === "string" ? data.name : "tool",
    toolCallId: callId,
    status: "running",
    args,
    startedAt: entry.event.time,
    // The parsed `args` above stays what presenters read; the raw arguments
    // string, turn/step location, and call-side render intent ride along.
    wire: {
      call: toolCallWireRecord(data, entry.event.time, entry.view),
    },
  });
  turn.timeline?.push({
    kind: "tool",
    id: `dsh:tool:${entry.event.seq}`,
    toolCallId: callId,
  });
}

function applyToolResult(turn: AssistantTurn, entry: AgentSessionHistoryEntry): void {
  const data = entry.event.data;
  const message = record(data.message);
  const callId = toolResultCallId(message);
  if (!callId) return;
  const prior = turn.tools.get(callId);
  turn.tools.set(callId, {
    tool: prior?.tool ?? "tool",
    toolCallId: callId,
    status: "completed",
    args: prior?.args,
    result: {
      text: contentText(message?.content),
      view: entry.view,
      meta: data.meta,
    },
    error: Boolean(message?.isError || data.error),
    startedAt: prior?.startedAt,
    durationMs:
      prior?.startedAt && entry.event.time >= prior.startedAt
        ? entry.event.time - prior.startedAt
        : undefined,
    // The flattened text and boolean `error` above stay what presenters read.
    // The call half is carried forward from the running record so a settled
    // pair keeps its arguments and call-side view; a result whose call fell
    // outside the window keeps `call` absent, exactly as the DSH runtime's own
    // builder reports `call: null` / `callTime: null` for it.
    wire: {
      ...(prior?.wire?.call ? { call: prior.wire.call } : {}),
      result: toolResultWireRecord(
        data,
        entry.event.seq,
        entry.event.time,
        entry.view,
      ),
    },
  });
}

/** Fold DSH's durable event log into the existing presentation message shape. */
export function projectRuntimeSessionHistory(
  entries: readonly AgentSessionHistoryEntry[],
): RuntimeSessionMessage[] {
  const output: RuntimeSessionMessage[] = [];
  let turn: AssistantTurn | null = null;
  const commands = new Map<string, { name: string; args: string; seq: number }>();

  for (const entry of [...entries].sort((a, b) => a.event.seq - b.event.seq)) {
    const event = entry.event;
    const compact = compactionUpdate(event);
    if (compact) {
      if (!turn) turn = beginTurn(event);
      upsertCompactionTimeline(turn.timeline!, compact);
      continue;
    }
    if (event.type === "command/run") {
      finishTurn(turn, output);
      turn = null;
      const commandId = typeof event.data.commandId === "string"
        ? event.data.commandId
        : `seq-${event.seq}`;
      const name = typeof event.data.name === "string" ? event.data.name : "command";
      const args = typeof event.data.args === "string" ? event.data.args : "";
      commands.set(commandId, { name, args, seq: event.seq });
      output.push({
        role: "user",
        content: `/${name}${args}`,
        uiId: `dsh:command:${commandId}:input`,
        runtimeSeq: event.seq,
        sentAt: event.time,
      });
      continue;
    }
    if (event.type === "command/done") {
      finishTurn(turn, output);
      turn = null;
      const commandId = typeof event.data.commandId === "string"
        ? event.data.commandId
        : `seq-${event.seq}`;
      const command = commands.get(commandId);
      const text = typeof event.data.text === "string" ? event.data.text : "";
      if (text) {
        output.push({
          role: "assistant",
          content: text,
          uiId: `dsh:command:${commandId}:result`,
          runtimeSeq: event.seq,
        });
      } else if (!command && event.data.kind === "error") {
        output.push({
          role: "assistant",
          content: "Command failed.",
          uiId: `dsh:command:${commandId}:result`,
          runtimeSeq: event.seq,
        });
      }
      continue;
    }
    if (event.type === "turn/start") {
      finishTurn(turn, output);
      turn = beginTurn(event);
      continue;
    }
    if (event.type === "amiba/notice") {
      const notice = presentationNotice(event.data);
      if (notice) output.push({ role: "user", ...notice, runtimeSeq: event.seq, sentAt: event.time });
      continue;
    }
    if (event.type === "user/message") {
      const message = messageFromEvent(event);
      // Which producers' user-role messages the conversation shows, and what
      // they are attributed to, is one shared decision with the live bridge
      // — see `visibleUserMessage`. A plugin-RELAYED message (the steward's
      // task brief, an IM connector's inbound message) is conversation and
      // keeps an `origin`; a plugin NOTICE (a task report, a guard's
      // reminder) is an account rather than a turn and additionally carries
      // its `notice` summary, which the surface renders as a collapsed row;
      // injected model context and tool results are neither, and are still
      // dropped here.
      const visible = visibleUserMessage(message?.source);
      if (!visible) continue;
      // Words and attachment envelopes are separated by the same shared
      // helper the live bridge uses, so a message reads identically whether
      // it arrived on the wire or was reloaded from the durable log.
      const { text, badges } = userMessageText(message?.content);
      output.push({
        role: "user",
        content: text,
        ...(visible.origin ? { origin: visible.origin } : {}),
        ...(visible.notice ? { notice: visible.notice } : {}),
        ...(badges.length ? { attachmentBadges: badges } : {}),
        uiId: userMessageUiId(message?.id, event.seq),
        runtimeSeq: event.seq,
        sentAt: event.time,
      });
      continue;
    }
    if (!turn) turn = beginTurn(event);
    if (event.type === "assistant/chunk") {
      const chunk = record(event.data.chunk);
      if (typeof chunk?.text !== "string") continue;
      if (chunk.type === "reasoning-delta") {
        turn.reasoning += chunk.text;
        const last = turn.timeline?.at(-1);
        if (last?.kind === "reasoning") { last.text += chunk.text; last.endedAt = event.time; }
        else turn.timeline?.push({kind:"reasoning",id:`dsh:reasoning:${event.seq}`,text:chunk.text,startedAt:event.time,endedAt:event.time});
        if (turn.reasoningStartAt === null) turn.reasoningStartAt = event.time;
        turn.reasoningEndAt = event.time;
        markProcessActivity(turn, event.time);
      } else if (chunk.type === "text-delta") turn.draftText += chunk.text;
      continue;
    }
    if (event.type === "assistant/message") {
      const message = messageFromEvent(event);
      const text = contentText(message?.content);
      if (text) {
        turn.text += text;
        turn.timeline?.push({
          kind: "text",
          id: `dsh:text:${event.seq}`,
          text,
        });
      }
      turn.draftText = "";
      continue;
    }
    if (event.type === "tool/call") {
      applyToolCall(turn, entry);
      markProcessActivity(turn, event.time);
      continue;
    }
    if (event.type === "tool/result") {
      applyToolResult(turn, entry);
      markProcessActivity(turn, event.time);
      continue;
    }
    if (event.type === "turn/end") {
      interruptOpenCompactions(turn.timeline!);
      finishTurn(turn, output);
      turn = null;
    }
  }
  finishTurn(turn, output);
  return output;
}
