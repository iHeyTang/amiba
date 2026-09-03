import type { SessionEvent } from "@deepseek-ai/dsh-session";

export const ASK_USER_TOOL = "ask_user_question";

export interface CompletedTurn {
  turn: number;
  endSeq: number;
  endedAt: number;
  userText: string;
  assistantText: string;
  reason: unknown;
  failed: boolean;
}

type Row = { type: string; seq: number; time: number; data: Record<string, unknown> };

function rows(events: readonly SessionEvent[]): readonly Row[] {
  return events as unknown as readonly Row[];
}

export function contentText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const row = block as Record<string, unknown>;
      return row.type === "text" && typeof row.text === "string" ? [row.text] : [];
    })
    .join("\n");
}

/**
 * `turn/end`'s `reason` is structured (`{kind:"error", error:{message}}`,
 * `{kind:"aborted", reason}`, `{kind:"completed"}`) — never interpolate it
 * directly. Mirrors messaging-core's describeTurnEndReason.
 */
export function describeTurnEndReason(reason: unknown): string {
  if (reason && typeof reason === "object") {
    const row = reason as Record<string, unknown>;
    if (typeof row.kind === "string") {
      const error = row.error;
      const message =
        error && typeof error === "object" ? (error as Record<string, unknown>).message : undefined;
      return typeof message === "string" && message.trim() ? `${row.kind}: ${message}` : row.kind;
    }
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
    }
  }
  return String(reason ?? "completed");
}

function turnFailed(reason: unknown): boolean {
  const kind = reason && typeof reason === "object" ? (reason as Record<string, unknown>).kind : undefined;
  return kind !== "completed";
}

export function lastSeq(events: readonly SessionEvent[]): number {
  const all = rows(events);
  return all.length ? all[all.length - 1]!.seq : -1;
}

/** Every finished turn whose `turn/end` seq is greater than `afterSeq`, oldest first. */
export function completedTurns(events: readonly SessionEvent[], afterSeq: number): CompletedTurn[] {
  const all = rows(events);
  const result: CompletedTurn[] = [];
  for (let endIndex = 0; endIndex < all.length; endIndex += 1) {
    const end = all[endIndex]!;
    if (end.type !== "turn/end" || end.seq <= afterSeq) continue;
    const turn = end.data.turn;
    if (typeof turn !== "number") continue;
    let startIndex = -1;
    for (let index = endIndex - 1; index >= 0; index -= 1) {
      const row = all[index]!;
      if (row.type === "turn/start" && row.data.turn === turn) {
        startIndex = index;
        break;
      }
    }
    if (startIndex < 0) continue;
    const userText: string[] = [];
    const assistantText: string[] = [];
    for (const row of all.slice(startIndex + 1, endIndex)) {
      if (row.type === "user/message") {
        const source = row.data.source as Record<string, unknown> | undefined;
        if (source?.kind === "tool") continue;
        const text = contentText(row.data.content);
        if (text) userText.push(text);
      } else if (row.type === "assistant/message" && row.data.turn === turn) {
        const message = row.data.message as Record<string, unknown> | undefined;
        const text = contentText(message?.content);
        if (text) assistantText.push(text);
      }
    }
    result.push({
      turn,
      endSeq: end.seq,
      endedAt: end.time,
      userText: userText.join("\n\n"),
      assistantText: assistantText.join("\n\n"),
      reason: end.data.reason,
      failed: turnFailed(end.data.reason),
    });
  }
  return result;
}

/** The latest `ask_user_question` call that has no `tool/result` yet. */
export function pendingAskUser(events: readonly SessionEvent[]): { callId: string; seq: number } | null {
  const all = rows(events);
  const answered = new Set<string>();
  for (const row of all) {
    if (row.type !== "tool/result") continue;
    const message = row.data.message as Record<string, unknown> | undefined;
    const blocks = Array.isArray(message?.content) ? (message!.content as Array<Record<string, unknown>>) : [];
    for (const block of blocks) {
      if (typeof block.toolCallId === "string") answered.add(block.toolCallId);
    }
  }
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const row = all[index]!;
    if (row.type !== "tool/call" || row.data.name !== ASK_USER_TOOL) continue;
    const callId = String(row.data.callId);
    return answered.has(callId) ? null : { callId, seq: row.seq };
  }
  return null;
}
