import type { ConversationLifecycle } from "./conversations.js";

interface HistoryEvent { type: string; time?: number; data: unknown }
export interface ConversationHistoryReader {
  read(sessionId: string): Promise<readonly HistoryEvent[]>;
  isClosed(sessionId: string): boolean;
}
export interface ConversationHistoryHit {
  sessionId: string;
  createdAt: number;
  excerpts: Array<{ role: "user" | "assistant"; text: string; time?: number }>;
}
function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n");
}

/** The caller's persisted session determines the scope. No model-selected
 * account, plugin or chat key can widen it. Tool outputs/credentials aren't indexed. */
export async function searchConversationHistory(
  lifecycle: ConversationLifecycle,
  callerSessionId: string,
  query: string,
  reader: ConversationHistoryReader,
  limit = 5,
  cursor = 0,
): Promise<{ hits: ConversationHistoryHit[]; scanned: number; hasMore: boolean; nextCursor?: number }> {
  const origin = await lifecycle.originForSession(callerSessionId);
  if (!origin) throw new Error("conversation_history_unavailable");
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || needle.length > 500) throw new Error("invalid_history_query");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("invalid_history_limit");
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("invalid_history_cursor");
  const segments = (await lifecycle.history(origin)).filter((segment) => segment.sessionId !== callerSessionId).reverse();
  const hits: ConversationHistoryHit[] = [];
  let scanned = 0;
  for (const segment of segments.slice(cursor, cursor + 200)) {
    scanned += 1;
    if (reader.isClosed(segment.sessionId)) continue;
    let events: readonly HistoryEvent[];
    try { events = await reader.read(segment.sessionId); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof Error && error.message === "session_not_found")) continue;
      throw error;
    }
    // Recheck after I/O so archive/revocation while searching isn't ignored.
    if (reader.isClosed(segment.sessionId)) continue;
    const excerpts: ConversationHistoryHit["excerpts"] = [];
    for (const event of events) {
      if (event.type !== "user/message" && event.type !== "assistant/message") continue;
      const data = event.data as { message?: { content?: unknown } } | null;
      const text = plainText(data?.message?.content);
      const index = text.toLocaleLowerCase().indexOf(needle);
      if (index < 0) continue;
      const start = Math.max(0, index - 160);
      excerpts.push({ role: event.type === "user/message" ? "user" : "assistant", text: text.slice(start, start + 1000), ...(event.time !== undefined ? { time: event.time } : {}) });
      if (excerpts.length === 5) break;
    }
    if (excerpts.length) hits.push({ sessionId: segment.sessionId, createdAt: segment.createdAt, excerpts });
    if (hits.length >= limit || scanned >= 200) break;
  }
  const hasMore = cursor + scanned < segments.length;
  return { hits, scanned, hasMore, ...(hasMore ? { nextCursor: cursor + scanned } : {}) };
}
