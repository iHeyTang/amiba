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
