// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionStats } from "./stats.js";
import { mountOfficialChatPresentation } from "../official-chat-presentation.js";
afterEach(cleanup);
const t = (key: string, values: Record<string, unknown> = {}) =>
  `${key} ${Object.values(values).join(" ")}`.trim();
const usage = {
  uncachedInputTokens: 10,
  cacheReadTokens: 80,
  cacheWriteTokens: 10,
  outputTokens: 20,
};
const stats = {
  turns: 4,
  steps: 6,
  llmMs: 3200,
  toolMs: 1000,
  ttftMs: 1200,
  ttftSteps: 2,
  decodeMs: 2000,
  decodeTokens: 100,
};
function props(values: Record<string, unknown>) {
  return {
    useProjection: (key: string) => values[key],
    t,
  } as unknown as Parameters<typeof SessionStats>[0];
}
it("reads whole-session projections, updates totals, and shows disjoint billing buckets", () => {
  const view = render(
    <SessionStats {...props({ tokenUsage: usage, sessionStats: stats })} />,
  );
  expect(screen.getByText(/count 120/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "stats.dialog.usageTitle" }),
  );
  expect(screen.getByRole("dialog").textContent).toContain("80%");
  expect(screen.getAllByText("message.turnUsage.count 10")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "stats.dialog.title" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByText("duration.compactSeconds 0.6")).toBeTruthy();
  expect(screen.getByText("message.tokensPerSecond 50.0")).toBeTruthy();
  view.rerender(
    <SessionStats {...props({ tokenUsage: { ...usage, outputTokens: 40 } })} />,
  );
  expect(screen.getByText(/count 140/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "stats.dialog.title" }),
  ).toBeNull();
});
it("hides absent data and avoids fabricated cache percentages for output-only usage", () => {
  const view = render(<SessionStats {...props({})} />);
  expect(view.container.firstChild).toBeNull();
  view.rerender(
    <SessionStats
      {...props({
        tokenUsage: {
          uncachedInputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 5,
        },
      })}
    />,
  );
  expect(screen.getByText("message.turnUsage.count 5")).toBeTruthy();
  expect(screen.queryByText(/stats.cacheHit/)).toBeNull();
});
it("does not round a partial cache hit up to 100 percent", () => {
  render(
    <SessionStats
      {...props({
        tokenUsage: {
          ...usage,
          uncachedInputTokens: 1,
          cacheWriteTokens: 0,
          cacheReadTokens: 99999,
        },
      })}
    />,
  );
  expect(screen.getByText(/stats.cacheHit 99.99/)).toBeTruthy();
});
it("restores only the official stats registration with the Amiba component and locale", () => {
  const register = vi.fn(() => () => {});
  mountOfficialChatPresentation(
    { slots: { register }, uiConversation: {}, uiSession: {} } as never,
    (ctx) => {
      ctx.slots.register(
        {
          name: "conversation.composer.dock",
          id: "stats",
          order: 0,
          locale: "chat",
        } as never,
        (() => null) as never,
      );
      ctx.slots.register(
        { name: "conversation.composer.dock", id: "other" } as never,
        (() => null) as never,
      );
    },
  );
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "conversation.composer.dock",
      id: "stats",
      locale: "chat",
      order: 0,
    }),
    SessionStats,
  );
});
