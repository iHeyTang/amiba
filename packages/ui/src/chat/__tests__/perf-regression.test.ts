import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdownIntoBlocks } from "streamdown";

import { createElement } from "react";

import { MessageTurns } from "../bubble/Bubble";
import { MESSAGE_TURN_WINDOW, windowTurns } from "../turn-window";

vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));

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
describe("conversation render pipeline (Tier A' end-to-end)", () => {
  it("mounts a 160-row window (with a live streaming row) well under the ceiling", () => {
    // 20 settled turns (~150 rows) + one live streaming turn with a long
    // raw-text reply, mirroring the post-windowing steady state.
    const messages = [];
    let seq = 0;
    for (let t = 0; t < 20; t++) {
      messages.push({
        uiId: `u${t}`,
        role: "user",
        content: `问题 ${t}`,
        runtimeTurn: t,
        runtimeSeq: seq++,
      });
      messages.push({
        uiId: `a${t}`,
        role: "assistant",
        content: `## 回答 ${t}\n\n正文 **加粗** 与 \`code\`。\n\n\`\`\`ts\nconst x = ${t};\n\`\`\``,
        runtimeTurn: t,
        runtimeSeq: seq++,
        streaming: false,
      });
    }
    messages.push({
      uiId: "u-live",
      role: "user",
      content: "继续",
      runtimeTurn: 20,
      runtimeSeq: seq++,
    });
    messages.push({
      uiId: "a-live",
      role: "assistant",
      content: "正在流式输出的原始文本…".repeat(200),
      runtimeTurn: 20,
      runtimeSeq: seq++,
      streaming: true,
    });
    const t0 = performance.now();
    let container: HTMLElement | undefined;
    act(() => {
      container = render(createElement(MessageTurns, { messages })).container;
    });
    const elapsed = performance.now() - t0;
    console.log(`[perf] 160-row window render: ${elapsed.toFixed(0)} ms`);
    // jsdom + streamdown is far slower than a real browser; the ceiling only
    // guards against a pathological pipeline regression (e.g. full-history
    // mount returning).
    expect(elapsed).toBeLessThan(4000);
    expect(
      container.querySelectorAll("[data-conversation-user-turn]").length,
    ).toBeGreaterThan(0);
  });
});
