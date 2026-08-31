// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

import { AskUserQuestionToolview } from "./ask-toolview";

const ARGS = JSON.stringify({
  questions: [
    { id: "target", question: "Which target?" },
    { id: "note", question: "Release note?" },
  ],
});

function settledBlock(overrides: Record<string, unknown>) {
  return {
    kind: "tool-result",
    seq: 2,
    time: 5_000,
    callId: "call-1",
    call: { name: "ask_user_question", argsRaw: ARGS },
    callTime: 1_000,
    content: [] as Array<{ type: string; text?: string }>,
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...overrides,
  } as never;
}

describe("AskUserQuestionToolview", () => {
  it("summarizes an answered call and expands into the Q&A review", () => {
    render(
      <AskUserQuestionToolview
        callId="call-1"
        toolName="ask_user_question"
        block={settledBlock({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                answers: [
                  { id: "target", selected: ["Code"] },
                  { id: "note", selected: [], custom: "ship it" },
                ],
              }),
            },
          ],
        })}
        openFile={() => {}}
      />,
    );
    expect(
      screen.getByText(/shell\.ask\.answered.*"answered":2.*"total":2/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Which target?")).toBeTruthy();
    expect(screen.getByText("Code")).toBeTruthy();
    expect(screen.getByText("ship it")).toBeTruthy();
  });

  it("renders a dismissed wait as a neutral user choice, not an error", () => {
    render(
      <AskUserQuestionToolview
        callId="call-1"
        toolName="ask_user_question"
        block={settledBlock({
          isError: true,
          content: [
            { type: "text", text: "Error: the user cancelled ask_user_question" },
          ],
        })}
        openFile={() => {}}
      />,
    );
    expect(screen.getByText("shell.ask.cancelled")).toBeTruthy();
    // Neutral: no destructive icon tint, no expandable error body.
    expect(document.querySelector(".text-destructive\\/80")).toBeNull();
  });

  it("shows the waiting state while the ask is still open", () => {
    render(
      <AskUserQuestionToolview
        callId="call-1"
        toolName="ask_user_question"
        block={
          {
            callId: "call-1",
            name: "ask_user_question",
            argsRaw: ARGS,
            turn: 1,
            step: 1,
            time: 1_000,
            callView: null,
            subCalls: [],
          } as never
        }
        openFile={() => {}}
      />,
    );
    expect(screen.getByText("shell.ask.waiting")).toBeTruthy();
  });
});
