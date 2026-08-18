import { describe, expect, it } from "vitest";

import type { AmibaUsageListResult, AmibaUsageRecord } from "../../remote.js";
import {
  fetchTokenHeatmap,
  fetchTokenRecent,
  fetchTokenSummary,
  type UsageListFn,
} from "../token-usage.js";

function record(overrides: Partial<AmibaUsageRecord> & { ts: number }): AmibaUsageRecord {
  return {
    sessionId: "session-1",
    turn: 0,
    step: 0,
    provider: "deepseek",
    model: "deepseek-chat",
    uncachedInputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    ...overrides,
  };
}

function listOf(records: AmibaUsageRecord[], failures: AmibaUsageListResult["failures"] = []): UsageListFn {
  return async () => ({ records, failures });
}

describe("fetchTokenSummary (list-injected, no platform adapter)", () => {
  it("aggregates today's totals and session counts across two sessions", async () => {
    const now = Date.now();
    const list = listOf([
      record({ ts: now, sessionId: "session-a", uncachedInputTokens: 10, outputTokens: 5 }),
      record({ ts: now - 1_000, sessionId: "session-a", uncachedInputTokens: 20, outputTokens: 10, turn: 1 }),
      record({ ts: now - 2_000, sessionId: "session-b", uncachedInputTokens: 7, outputTokens: 3 }),
    ]);

    const summary = await fetchTokenSummary(list);

    expect(summary.today.turns).toBe(3);
    expect(summary.today.sessions).toBe(2);
    expect(summary.today.totalTokens).toBe(10 + 5 + 20 + 10 + 7 + 3);
    expect(summary.lifetime.totalTokens).toBe(summary.today.totalTokens);
  });

  it("ranks byModelLast7 by window-total tokens descending", async () => {
    const now = Date.now();
    const list = listOf([
      record({ ts: now, model: "small-model", uncachedInputTokens: 1, outputTokens: 1 }),
      record({ ts: now - 500, model: "big-model", uncachedInputTokens: 500, outputTokens: 500, turn: 1 }),
    ]);

    const summary = await fetchTokenSummary(list);

    expect(summary.byModelLast7[0]!.model).toBe("deepseek/big-model");
    expect(summary.byModelLast7[1]!.model).toBe("deepseek/small-model");
  });

  it("surfaces the first failure message when no records could be read", async () => {
    const list = listOf([], [{ sessionId: "broken-session", message: "session log corrupted" }]);
    await expect(fetchTokenSummary(list)).rejects.toThrow("session log corrupted");
  });
});

describe("fetchTokenRecent", () => {
  it("sorts newest-first and respects the limit", async () => {
    const now = Date.now();
    const list = listOf([
      record({ ts: now - 3_000, sessionId: "oldest" }),
      record({ ts: now, sessionId: "newest", turn: 2 }),
      record({ ts: now - 1_000, sessionId: "middle", turn: 1 }),
    ]);

    const recent = await fetchTokenRecent(list, 2);

    expect(recent).toHaveLength(2);
    expect(recent[0]!.sessionId).toBe("newest");
    expect(recent[1]!.sessionId).toBe("middle");
  });
});

describe("fetchTokenHeatmap", () => {
  it("buckets today's tokens into the last cell with a per-model breakdown", async () => {
    const now = Date.now();
    const list = listOf([
      record({ ts: now, model: "model-a", uncachedInputTokens: 4, outputTokens: 1 }),
      record({ ts: now - 100, model: "model-b", uncachedInputTokens: 2, outputTokens: 3, turn: 1 }),
    ]);

    const cells = await fetchTokenHeatmap(list, 1);

    const todayCell = cells.at(-1)!;
    expect(todayCell.value).toBe(4 + 1 + 2 + 3);
    expect(todayCell.modelBreakdown.map((m) => m.model).sort()).toEqual([
      "deepseek/model-a",
      "deepseek/model-b",
    ]);
  });
});
