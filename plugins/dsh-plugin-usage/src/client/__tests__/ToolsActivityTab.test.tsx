import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyToolActivityTotals,
  toolActivityDayKey,
  type ToolActivityReadResult,
  type ToolInvocation,
} from "../../tool-activity.js";
import { ToolsActivityTab } from "../ToolsActivityTab.js";
import type { ToolActivityReadFn } from "../tool-usage.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function invocation(
  overrides: Partial<ToolInvocation> & { ts: number; toolCallId: string },
): ToolInvocation {
  return {
    sessionId: "session-1",
    runId: "session-1:0",
    tool: "search",
    completed: true,
    durationMs: 42,
    ...overrides,
  };
}

function readerOf(todayRows: ToolInvocation[]): ToolActivityReadFn {
  return async (days: number): Promise<ToolActivityReadResult> => {
    const out: ToolActivityReadResult = {
      days: [],
      lifetime: emptyToolActivityTotals(),
    };
    for (let i = 0; i < days; i++) {
      const day = toolActivityDayKey(Date.now() - i * DAY_MS);
      out.days.push({ day, rows: i === 0 ? todayRows : [] });
    }
    return out;
  };
}

describe("ToolsActivityTab (remote-read injected — no desktop IPC source)", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
  });

  it("renders today's hero counts and the recent-call list from the injected read()", async () => {
    const now = Date.now();
    const read = vi.fn(
      readerOf([
        invocation({ ts: now, toolCallId: "c1", tool: "search" }),
        invocation({ ts: now - 1_000, toolCallId: "c2", tool: "shell", durationMs: 7 }),
      ]),
    );

    render(<ToolsActivityTab read={read} />);

    // Hero "Calls" stat: 2 calls today. Scoped to the hero card itself.
    const callsLabel = await screen.findByText("Calls");
    const callsCard = callsLabel.closest("div")!;
    expect(within(callsCard).getByText("2")).toBeVisible();
    expect(screen.getByText("Tools")).toBeVisible();
    expect(screen.getByText("Unfinished")).toBeVisible();

    // The tool name shows up in both "By tool" and "Recent calls".
    const toolMentions = await screen.findAllByText("shell");
    expect(toolMentions.length).toBeGreaterThan(0);
    expect(screen.getByText("7ms")).toBeVisible();
    expect(read).toHaveBeenCalled();
  });

  it("marks a call whose completion never arrived as Running", async () => {
    const now = Date.now();
    const read = readerOf([
      invocation({
        ts: now,
        toolCallId: "c1",
        completed: false,
        durationMs: undefined,
      }),
    ]);

    render(<ToolsActivityTab read={read} />);

    expect(await screen.findByText("Running")).toBeVisible();
  });

  it("shows the empty state and no crash when read() resolves empty", async () => {
    const read = readerOf([]);

    render(<ToolsActivityTab read={read} />);

    const empties = await screen.findAllByText("No data yet.");
    expect(empties.length).toBeGreaterThan(0);
  });

  it("surfaces a read() rejection as an inline error instead of throwing", async () => {
    const read: ToolActivityReadFn = async () => {
      throw new Error("ledger unreachable");
    };

    render(<ToolsActivityTab read={read} />);

    expect(await screen.findByText("ledger unreachable")).toBeVisible();
  });
});
