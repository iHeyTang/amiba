import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

/**
 * The stateful process/result exception: narration written right before a
 * user-wait (ask_user_question, undecided approvals) is the user's basis
 * for responding and must stay visible while the wait is open; once the
 * wait resolves it is ordinary process content and folds away.
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

describe("await-user process fold", () => {
  it("keeps the narration before a running ask_user_question visible", () => {
    render(
      <MessageTurns
        messages={turn({
          streaming: true,
          toolProgress: [
            { tool: "ask_user_question", toolCallId: "ask-1", status: "running" },
          ],
        })}
      />,
    );
    expect(screen.getByText(NARRATION)).toBeInTheDocument();
  });

  it("keeps the narration before an undecided approval visible", () => {
    render(
      <MessageTurns
        messages={turn({
          streaming: true,
          assistantTimeline: [
            { kind: "text", id: "t1", text: NARRATION },
            { kind: "approval", id: "ap1", approvalId: "approval-1" },
          ],
          approvalRecords: [
            { approvalId: "approval-1", requestedAt: 1, command: "rm -rf x" },
          ],
        })}
      />,
    );
    expect(screen.getByText(NARRATION)).toBeInTheDocument();
  });

  it("folds the same narration once the wait resolves", () => {
    render(
      <MessageTurns
        messages={turn({
          toolProgress: [
            {
              tool: "ask_user_question",
              toolCallId: "ask-1",
              status: "completed",
            },
          ],
        })}
      />,
    );
    expect(screen.queryByText(NARRATION)).not.toBeInTheDocument();
  });
});
