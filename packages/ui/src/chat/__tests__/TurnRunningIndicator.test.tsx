import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { AwaitingUserInputContext, MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

/**
 * A turn that is still running must SAY so at its tail. Between the moment
 * the model finishes a line of prose and the moment its next tool call
 * lands (generating a large `write` body can take a long while), no new
 * event reaches the transcript: the process row already reads as
 * completed ("worked for 14s") and the text sits still. Without a trailing
 * indicator the only sign of life is the composer's stop button.
 */

const WORKING = "sidepanel.trace.working";
const PROSE = "现在创建完整的 HTML 演示稿。";

function interleaved(overrides: Partial<UiMessage>): UiMessage[] {
  return [
    { uiId: "u1", role: "user", content: "帮我做一个年度汇报 PPT" },
    {
      uiId: "a1",
      role: "assistant",
      content: PROSE,
      processMs: 14_000,
      assistantTimeline: [
        { kind: "tool", id: "tl1", toolCallId: "call-1" },
        { kind: "text", id: "t1", text: PROSE },
      ],
      toolProgress: [
        { tool: "amiba_browser_navigate", toolCallId: "call-1", status: "completed" },
      ],
      ...overrides,
    } as UiMessage,
  ];
}

function renderTurn(messages: UiMessage[], awaiting = false) {
  return render(
    <AwaitingUserInputContext.Provider value={awaiting}>
      <MessageTurns messages={messages} />
    </AwaitingUserInputContext.Provider>,
  );
}

describe("turn running indicator", () => {
  it("trails a streaming turn whose prose has settled after a completed tool", () => {
    renderTurn(interleaved({ streaming: true }));
    expect(screen.getByText(PROSE)).toBeInTheDocument();
    expect(screen.getByText(WORKING)).toBeInTheDocument();
  });

  it("disappears once the turn is over", () => {
    renderTurn(interleaved({}));
    expect(screen.getByText(PROSE)).toBeInTheDocument();
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
  });

  it("stays quiet while the session is paused on the user", () => {
    renderTurn(interleaved({ streaming: true }), true);
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
  });

  it("also trails a plain streaming answer with no tool timeline", () => {
    renderTurn([
      { uiId: "u1", role: "user", content: "hi" },
      { uiId: "a1", role: "assistant", content: PROSE, streaming: true } as UiMessage,
    ]);
    expect(screen.getByText(WORKING)).toBeInTheDocument();
  });
});


describe("one activity owner", () => {
  const thought: UiMessage = {
    uiId: "a1", role: "assistant", content: "", streaming: true,
    assistantTimeline: [{ kind: "reasoning", id: "r1", text: "Inspecting the request" }],
  };
  const view = (message: UiMessage, awaiting = false) => (
    <AwaitingUserInputContext.Provider value={awaiting}>
      <MessageTurns messages={[message]} />
    </AwaitingUserInputContext.Provider>
  );

  it("owns an interleaved turn with ONE disclosure whose rows follow the timeline", () => {
    const { rerender, container } = render(view(thought));
    // Thinking alone owns the turn: one disclosure, labeled as live thinking,
    // and no separate working tail.
    expect(screen.getAllByText("sidepanel.trace.thinking")).toHaveLength(1);
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-execution-summary]")).toHaveLength(1);
    const running: UiMessage = {
      ...thought,
      assistantTimeline: [...thought.assistantTimeline!, { kind: "tool", id: "t1", toolCallId: "call-1" }],
      toolProgress: [{ tool: "read_file", toolCallId: "call-1", status: "running" }],
    };
    rerender(view(running));
    // The tool joins the SAME disclosure as its own row — the thought is not
    // yanked into a separate top fold — and the running chip owns the label.
    const disclosures = container.querySelectorAll("[data-execution-summary]");
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]!.textContent ?? "").toContain("Inspecting the request");
    expect(disclosures[0]!.querySelector(".agent-thinking-text")).not.toBeNull();
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
    const waiting: UiMessage = {
      ...running, toolProgress: [{ ...running.toolProgress![0]!, status: "completed" }],
    };
    rerender(view(waiting));
    // The tool settled and no live reasoning has arrived yet: the run state
    // lives INSIDE the fold summary as the unified "已执行 … · 正在思考…" line
    // — no detached working tail below the fold — while the thought row stays
    // in the series.
    const waitingButton = container.querySelector("[data-execution-summary] > button")!;
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-execution-summary]")).toHaveLength(1);
    expect(
      container.querySelector("[data-execution-summary]")!.textContent ?? "",
    ).toContain("Inspecting the request");
    expect(waitingButton.textContent ?? "").toContain("sidepanel.trace.thinking");
    rerender(view(waiting, true));
    expect(waitingButton.textContent ?? "").not.toContain("sidepanel.trace.thinking");
    rerender(view({ ...waiting, streaming: false }));
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
  });

  it("uses the generic fallback before any model content arrives", () => {
    const { rerender } = render(view({ uiId: "empty", role: "assistant", content: "", streaming: true }));
    expect(screen.getAllByText(WORKING)).toHaveLength(1);
    expect(screen.queryByText("sidepanel.trace.thinking")).not.toBeInTheDocument();
    rerender(view({ uiId: "empty", role: "assistant", content: "", streaming: true }, true));
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
  });

  it("does not suppress a later wait just because historical reasoning exists", () => {
    const { container } = render(view({ ...thought, content: PROSE, assistantTimeline: [
      ...thought.assistantTimeline!, { kind: "text", id: "prose", text: PROSE },
    ] }));
    expect(screen.getByText(PROSE)).toBeInTheDocument();
    expect(screen.getAllByText(WORKING)).toHaveLength(1);
    // Historical reasoning keeps its own row inside the series; it neither
    // fragments the series nor hides the still-streaming prose wait.
    expect(container.querySelectorAll("[data-execution-summary]")).toHaveLength(1);
    expect(
      container.querySelector("[data-execution-summary]")!.textContent ?? "",
    ).toContain("Inspecting the request");
  });
});
