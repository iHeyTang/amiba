import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { AwaitingUserInputContext, MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

/** Interaction context must remain readable throughout waiting and resumed work. */

const NARRATION = "回答前请先看这段说明";

function turn(overrides: Partial<UiMessage>): UiMessage[] {
  return [
    { uiId: "u1", role: "user", content: "hi" },
    {
      uiId: "a1",
      role: "assistant",
      content: NARRATION,
      assistantTimeline: [
        { kind: "text", id: "t1", text: NARRATION },
        { kind: "tool", id: "tl1", toolCallId: "ask-1" },
      ],
      ...overrides,
    } as UiMessage,
  ];
}

function renderTurn(awaiting: boolean, overrides: Partial<UiMessage>) {
  return render(
    <AwaitingUserInputContext.Provider value={awaiting}>
      <MessageTurns messages={turn(overrides)} />
    </AwaitingUserInputContext.Provider>,
  );
}

describe("await-user process fold", () => {
  it("keeps the narration before an open interaction wait visible", () => {
    renderTurn(true, {
      streaming: true,
      toolProgress: [
        { tool: "ask_user_question", toolCallId: "ask-1", status: "running" },
      ],
    });
    expect(screen.getByText(NARRATION)).toBeInTheDocument();
  });

  it("covers third-party tools with no registration — only the wait matters", () => {
    renderTurn(true, {
      streaming: true,
      toolProgress: [
        {
          tool: "some_plugin_interactive_tool",
          toolCallId: "ask-1",
          status: "running",
        },
      ],
    });
    expect(screen.getByText(NARRATION)).toBeInTheDocument();
  });

  it("keeps narration visible when the wait resolves and execution continues", () => {
    renderTurn(false, {
      streaming: true,
      toolProgress: [
        { tool: "ask_user_question", toolCallId: "ask-1", status: "completed" },
      ],
    });
    expect(screen.getByText(NARRATION)).toBeVisible();
  });

  it("folds the same narration once the turn finishes", () => {
    renderTurn(false, {
      toolProgress: [
        { tool: "ask_user_question", toolCallId: "ask-1", status: "completed" },
      ],
    });
    expect(screen.queryByText(NARRATION)).not.toBeInTheDocument();
  });
});
