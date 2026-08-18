import { describe, expect, it } from "vitest";

import {
  emptyToolActivityTotals,
  toolActivityDayKey,
  type ToolActivityReadResult,
  type ToolInvocation,
} from "../../tool-activity.js";
import {
  fetchToolHeatmap,
  fetchToolRecent,
  fetchToolSummary,
  type ToolActivityReadFn,
} from "../tool-usage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function invocation(
  overrides: Partial<ToolInvocation> & { ts: number; toolCallId: string },
): ToolInvocation {
  return {
    sessionId: "session-1",
    runId: "session-1:0",
    tool: "search",
    completed: true,
    durationMs: 10,
    ...overrides,
  };
}

/** Reader stub honoring the wire contract: newest day first, exactly the
 *  requested number of buckets. */
function readerOf(
  rowsByDay: Record<string, ToolInvocation[]>,
  lifetime = emptyToolActivityTotals(),
): ToolActivityReadFn {
  return async (days: number): Promise<ToolActivityReadResult> => {
    const out: ToolActivityReadResult = { days: [], lifetime };
    for (let i = 0; i < days; i++) {
      const day = toolActivityDayKey(Date.now() - i * DAY_MS);
      out.days.push({ day, rows: rowsByDay[day] ?? [] });
    }
    return out;
  };
}

describe("fetchToolSummary", () => {
  it("aggregates today's calls, distinct tools, and unfinished count", async () => {
    const now = Date.now();
    const today = toolActivityDayKey(now);
    const read = readerOf({
      [today]: [
        invocation({ ts: now, toolCallId: "c1", tool: "search" }),
        invocation({ ts: now - 1_000, toolCallId: "c2", tool: "shell" }),
        invocation({
          ts: now - 2_000,
          toolCallId: "c3",
          tool: "shell",
          completed: false,
          durationMs: undefined,
        }),
      ],
    });

    const summary = await fetchToolSummary(read);

    expect(summary.today.calls).toBe(3);
    expect(summary.today.distinctTools).toBe(2);
    expect(summary.today.unfinished).toBe(1);
    expect(summary.last7Days).toHaveLength(7);
  });

  it("ranks byToolLast7 by window-total calls descending with per-day buckets pre-seeded", async () => {
    const now = Date.now();
    const today = toolActivityDayKey(now);
    const yesterday = toolActivityDayKey(now - DAY_MS);
    const read = readerOf({
      [today]: [invocation({ ts: now, toolCallId: "c1", tool: "rare" })],
      [yesterday]: [
        invocation({ ts: now - DAY_MS, toolCallId: "c2", tool: "busy" }),
        invocation({ ts: now - DAY_MS, toolCallId: "c3", tool: "busy" }),
      ],
    });

    const summary = await fetchToolSummary(read);

    expect(summary.byToolLast7[0]!.tool).toBe("busy");
    expect(summary.byToolLast7[1]!.tool).toBe("rare");
    // Every tool row carries a bucket for every day in the window.
    expect(summary.byToolLast7[0]!.perDay).toHaveLength(7);
    expect(summary.byToolLast7[0]!.perDay[0]!.calls).toBe(0); // today: no "busy"
    expect(summary.byToolLast7[0]!.perDay[1]!.calls).toBe(2);
  });
});

describe("fetchToolRecent", () => {
  it("returns newest-first (within a day, append order reversed) and respects the limit", async () => {
    const now = Date.now();
    const today = toolActivityDayKey(now);
    const yesterday = toolActivityDayKey(now - DAY_MS);
    const read = readerOf({
      [today]: [
        invocation({ ts: now - 2_000, toolCallId: "older" }),
        invocation({ ts: now, toolCallId: "newest" }),
      ],
      [yesterday]: [invocation({ ts: now - DAY_MS, toolCallId: "yesterday" })],
    });

    const recent = await fetchToolRecent(read, 2);

    expect(recent.map((r) => r.toolCallId)).toEqual(["newest", "older"]);
  });
});

describe("fetchToolHeatmap", () => {
  it("buckets today's calls into the last cell with a per-tool breakdown sorted by calls", async () => {
    const now = Date.now();
    const today = toolActivityDayKey(now);
    const read = readerOf({
      [today]: [
        invocation({ ts: now, toolCallId: "c1", tool: "search" }),
        invocation({ ts: now, toolCallId: "c2", tool: "shell" }),
        invocation({ ts: now, toolCallId: "c3", tool: "shell" }),
      ],
    });

    const cells = await fetchToolHeatmap(read, 1);

    expect(cells).toHaveLength(7);
    const todayCell = cells.at(-1)!;
    expect(todayCell.day).toBe(today);
    expect(todayCell.value).toBe(3);
    expect(todayCell.level).toBeGreaterThan(0);
    expect(todayCell.toolBreakdown).toEqual([
      { tool: "shell", calls: 2 },
      { tool: "search", calls: 1 },
    ]);
  });
});
