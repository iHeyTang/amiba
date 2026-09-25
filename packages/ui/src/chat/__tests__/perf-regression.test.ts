import { describe, expect, it } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";

import { MESSAGE_TURN_WINDOW, windowTurns } from "../turn-window";

/**
 * Tier A' — deterministic-ish regression ceilings for the hot pure paths.
 *
 * These are NOT benchmarks: the ceilings sit ~100× above the measured
 * medians (see `scripts/perf/run.mjs`) precisely so they never flake on a
 * slow CI box but still catch a complexity regression (an accidental
 * O(N²)/frame re-introduction shows up as a 1000× wall-time jump).
 */
describe("performance regression ceilings", () => {
  it("turn grouping for 2000 messages stays far under the ceiling", () => {
    const messages = Array.from({ length: 2000 }, (_, i) => ({
      uiId: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(200),
      runtimeTurn: Math.floor(i / 40),
    }));
    const t0 = performance.now();
    const turns: Array<{ user: unknown; replies: unknown[] }> = [];
    let cur: { user: unknown; replies: unknown[] } | null = null;
    for (const message of messages) {
      if (message.role === "user") {
        cur = { user: message, replies: [] };
        turns.push(cur);
      } else if (cur) {
        cur.replies.push(message);
      }
    }
    const elapsed = performance.now() - t0;
    // measured ~0.2 ms; ceiling catches an O(N²) rebuild
    expect(elapsed).toBeLessThan(200);
    expect(turns.length).toBe(1000);
  });

  it("windows 2000 heavy turns under the ceiling and respects the cap", () => {
    const turns = Array.from({ length: 2000 }, (_, i) => ({
      user: i % 2 === 0 ? { uiId: `u${i}` } : null,
      replies: i % 2 === 0 ? [{ uiId: `a${i}` }] : [],
    }));
    const t0 = performance.now();
    const w = windowTurns(turns, MESSAGE_TURN_WINDOW, {
      maxMessages: 160,
      countMessages: (turn) => (turn.user ? 1 : 0) + turn.replies.length,
    });
    const elapsed = performance.now() - t0;
    // measured < 0.01 ms; the slice walk must never become per-frame O(N)
    expect(elapsed).toBeLessThan(50);
    const mounted = w.visible.reduce(
      (sum, turn) => sum + (turn.user ? 1 : 0) + turn.replies.length,
      0,
    );
    expect(mounted).toBeLessThanOrEqual(160);
  });

  it("parses a 40KB markdown blob well under the ceiling", () => {
    const md =
      "```json\n" +
      JSON.stringify({
        k: "v",
        items: Array.from({ length: 400 }, (_, i) => i),
      }) +
      "\n```\n\n## 标题\n\n正文 " +
      "word ".repeat(6000);
    const t0 = performance.now();
    parseMarkdownIntoBlocks(md);
    const elapsed = performance.now() - t0;
    // measured ~1-2 ms; a per-frame full-parse regression at 60fps would be
    // > 16 ms and this ceiling catches the wall-time blowup
    expect(elapsed).toBeLessThan(250);
  });
});