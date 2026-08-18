import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AmibaUsageRecord } from "../../remote.js";
import { TokensTab } from "../TokensTab.js";

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

describe("TokensTab (list-injected — no getPlatform().agentUsage)", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
  });

  it("renders today's hero totals and the recent session list from the injected list()", async () => {
    const now = Date.now();
    const list = vi.fn().mockResolvedValue({
      records: [
        record({ ts: now, sessionId: "session-a", uncachedInputTokens: 10, outputTokens: 5 }),
      ],
      failures: [],
    });

    render(<TokensTab list={list} />);

    // Hero "Tokens" stat: 10 + 5 = 15. Scoped to the hero card itself —
    // "15" also appears in the trend/recent rows below, so a bare
    // findByText would match more than one node.
    const tokensLabel = await screen.findByText("Tokens");
    const tokensCard = tokensLabel.closest("div")!;
    expect(within(tokensCard).getByText("15")).toBeVisible();
    expect(screen.getByText("Turns")).toBeVisible();
    expect(screen.getByText("Sessions")).toBeVisible();

    // The model is attributed as "provider/model" — it shows up in both
    // "By model" and "Recent sessions" for a single-model fixture.
    const modelMentions = await screen.findAllByText("deepseek/deepseek-chat");
    expect(modelMentions.length).toBeGreaterThan(0);
    expect(list).toHaveBeenCalled();
  });

  it("shows the empty state and no crash when the injected list() resolves empty", async () => {
    const list = vi.fn().mockResolvedValue({ records: [], failures: [] });

    render(<TokensTab list={list} />);

    const empties = await screen.findAllByText("No data yet.");
    expect(empties.length).toBeGreaterThan(0);
  });

  it("surfaces a failure message from list() as an inline error instead of throwing", async () => {
    const list = vi.fn().mockResolvedValue({
      records: [],
      failures: [{ sessionId: "broken", message: "session log corrupted" }],
    });

    render(<TokensTab list={list} />);

    expect(await screen.findByText("session log corrupted")).toBeVisible();
  });
});
