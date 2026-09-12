import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import type { ConversationLifecycle } from "./conversations.js";
import { searchConversationHistory } from "./conversation-history.js";

export function conversationHistoryTool(ctx: Context, lifecycle: ConversationLifecycle): ToolDefinition {
  return {
    name: "conversation_search_history",
    description: "Search earlier conversations belonging to this same chat entry. Use when the user refers to a previous day or week. Returns matching user/assistant excerpts; never searches other groups, private chats or accounts. When hasMore is true, pass nextCursor as cursor to continue searching older history.",
    parameters: {
      type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 }, cursor: { type: "integer", minimum: 0 } },
      required: ["query"], additionalProperties: false,
    } as never,
    output: {
      schema: { type: "object", properties: { content: { type: "array", items: {} } }, required: ["content"] } as never,
      render: (_args, result) => (result as { content: unknown }).content as never,
    },
    execute: async (args, execution) => {
      const sessionId = execution.agent?.session.id;
      if (!sessionId) throw new Error("conversation_history_unavailable");
      const input = args as { query: string; limit?: number; cursor?: number };
      const persistence = ctx.reflect.get("sessionPersistence") as {
        inspect(id: string): Promise<{ events: Array<{ type: string; data: unknown; time?: number }> }>;
      } | undefined;
      if (!persistence) throw new Error("conversation_history_unavailable");
      const result = await searchConversationHistory(lifecycle, sessionId, input.query, {
        read: async (id) => {
          execution.signal.throwIfAborted();
          return (await persistence.inspect(id)).events;
        },
        isClosed: (id) => {
          const registry = ctx.reflect.get("workspaceRegistry") as { archivedSessionIds: readonly string[] } | undefined;
          return registry?.archivedSessionIds.includes(id) ?? false;
        },
      }, input.limit, input.cursor);
      execution.signal.throwIfAborted();
      return { content: [{ type: "text", text: JSON.stringify(result) }] } as never;
    },
  };
}
