import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { AwaitingUserInputContext, MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

/**
 * The stateful process/result exception, driven by the WAIT ITSELF rather
 * than a tool-name registry: while the host reports an open interaction
 * wait (pending question or approval), the narration the agent wrote just
 * before pausing is the user's basis for responding and stays visible;
 * once the wait resolves it is ordinary process content and folds away.
 * Any tool pausing through the official interaction seams gets this with
 * no registration.
 */

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

  it("folds the same narration once the wait resolves", () => {
    renderTurn(false, {
      toolProgress: [
        { tool: "ask_user_question", toolCallId: "ask-1", status: "completed" },
      ],
    });
    expect(screen.queryByText(NARRATION)).not.toBeInTheDocument();
  });
});
