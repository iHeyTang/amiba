import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { ConversationLifecycle } from "./conversations.js";
import { searchConversationHistory } from "./conversation-history.js";

it("searches only the caller's own prior segments and excludes tool output", async () => {
  const root = await mkdtemp(join(tmpdir(), "conversation-history-"));
  try {
    const service = new ConversationLifecycle(root);
    const origin = { plugin: "lark", entry: "account", scope: "group" };
    await service.adopt(origin, "old", 1);
    await service.adopt(origin, "current", 2);
    await service.adopt({ ...origin, scope: "private" }, "private", 3);
    const read = vi.fn(async () => [
      { type: "tool/result", data: { message: { content: "needle secret" } } },
      { type: "user/message", data: { message: { content: [{ type: "text", text: "find needle here" }] } } },
    ]);
    const result = await searchConversationHistory(service, "current", "needle", { read, isClosed: () => false });
    expect(read.mock.calls).toHaveLength(1);
    expect(read).toHaveBeenCalledWith("old");
    expect(result.hits).toEqual([{ sessionId: "old", createdAt: 1, excerpts: [{ role: "user", text: "find needle here" }] }]);
    await expect(searchConversationHistory(service, "unknown", "needle", { read, isClosed: () => false })).rejects.toThrow("conversation_history_unavailable");
    const archived = await searchConversationHistory(service, "current", "needle", { read, isClosed: () => true });
    expect(archived.hits).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("continues through older history and bounds pages even when all newer segments are archived", async () => {
  const root = await mkdtemp(join(tmpdir(), "conversation-history-pages-"));
  try {
    const service = new ConversationLifecycle(root);
    const origin = { plugin: "lark", entry: "account", scope: "group" };
    for (let i = 0; i < 202; i++) await service.adopt(origin, `session-${i}`, i);
    const read = vi.fn(async () => [{ type: "user/message", data: { message: { content: "needle from the oldest conversation" } } }]);
    const reader = { read, isClosed: (id: string) => id !== "session-0" };
    const first = await searchConversationHistory(service, "session-201", "needle", reader);
    expect(first).toMatchObject({ hits: [], scanned: 200, hasMore: true, nextCursor: 200 });
    const older = await searchConversationHistory(service, "session-201", "needle", reader, 5, first.nextCursor);
    expect(older.hits[0]?.sessionId).toBe("session-0");
    expect(older.hasMore).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    await expect(searchConversationHistory(service, "session-201", "needle", reader, 5, -1)).rejects.toThrow("invalid_history_cursor");
  } finally { await rm(root, { recursive: true, force: true }); }
});
