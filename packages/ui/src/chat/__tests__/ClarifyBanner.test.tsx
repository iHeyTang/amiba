import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock("streamdown", () => ({
  defaultRemarkPlugins: {},
  defaultRehypePlugins: {},
  Streamdown: ({ children }: { children?: string }) => <div>{children}</div>,
}));

import { ClarifyBanner, planReviewOf } from "../bubble/clarify";

describe("ClarifyBanner", () => {
  it("steps through a DSH batch one question at a time before responding", () => {
    const onRespond = vi.fn();
    render(
      <ClarifyBanner
        error={null}
        inFlight={false}
        onRespond={onRespond}
        request={{
          requestId: "question-rpc",
          sessionId: "session-1",
          questions: [
            {
              id: "target",
              question: "Target?",
              options: [{ label: "Code", description: "Change source" }],
            },
            { id: "note", question: "Release note?" },
          ],
        }}
      />,
    );

    // Step 1 only — the second question is not rendered yet.
    expect(screen.getByText("Target?")).toBeInTheDocument();
    expect(screen.queryByText("Release note?")).not.toBeInTheDocument();

    // Picking a single-select option advances to the next step.
    fireEvent.click(screen.getByRole("radio", { name: /Code/ }));
    expect(screen.getByText("Release note?")).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "sidepanel.clarify.customAnswer" }),
      { target: { value: "Document the migration" } },
    );
    // The last step's primary action is submit, not next.
    fireEvent.click(
      screen.getByRole("button", { name: "sidepanel.clarify.submit" }),
    );

    expect(onRespond).toHaveBeenCalledWith([
      { id: "target", selected: ["Code"] },
      { id: "note", selected: [], custom: "Document the migration" },
    ]);
  });

  it("skips a question as an empty answer and pages back for edits", () => {
    const onRespond = vi.fn();
    render(
      <ClarifyBanner
        error={null}
        inFlight={false}
        onRespond={onRespond}
        request={{
          requestId: "question-rpc",
          sessionId: "session-1",
          questions: [
            { id: "a", question: "First?" },
            { id: "b", question: "Second?" },
          ],
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "sidepanel.clarify.skip" }),
    );
    expect(screen.getByText("Second?")).toBeInTheDocument();

    // The pager walks back to the skipped question.
    fireEvent.click(
      screen.getByRole("button", { name: "sidepanel.clarify.prev" }),
    );
    expect(screen.getByText("First?")).toBeInTheDocument();
    // Pager arrow and the primary action share the "next" wording; the
    // pager renders first in the footer.
    fireEvent.click(
      screen.getAllByRole("button", { name: "sidepanel.clarify.next" })[0],
    );

    fireEvent.click(
      screen.getByRole("button", { name: "sidepanel.clarify.skip" }),
    );
    expect(onRespond).toHaveBeenCalledWith([
      { id: "a", selected: [] },
      { id: "b", selected: [] },
    ]);
  });

  it("renders a plan-review intent as an approve/decline decision card", () => {
    const onRespond = vi.fn();
    const onCancel = vi.fn();
    render(
      <ClarifyBanner
        error={null}
        inFlight={false}
        onCancel={onCancel}
        onRespond={onRespond}
        request={{
          requestId: "question-rpc",
          sessionId: "session-1",
          questions: [
            {
              id: "plan",
              question: "Proceed with this plan?",
              detail: "1. refactor\n2. test",
              intent: { kind: "plan-review", approve: "Approve" },
              options: [{ label: "Approve" }, { label: "Refuse" }],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("sidepanel.clarify.plan.header")).toBeInTheDocument();
    expect(screen.getByText(/1\. refactor/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "sidepanel.clarify.plan.approve" }),
    );
    expect(onRespond).toHaveBeenCalledWith([
      { id: "plan", selected: ["Approve"] },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "sidepanel.clarify.plan.discuss" }),
    );
    expect(onCancel).toHaveBeenCalled();
  });

  it("leaves malformed plan-review intents to the generic stepper", () => {
    // Approve label missing from the options — two buttons cannot express
    // the request's answers, so the generic flow keeps it.
    expect(
      planReviewOf([
        {
          id: "plan",
          question: "Proceed?",
          detail: "the plan",
          intent: { kind: "plan-review", approve: "Approve" },
          options: [{ label: "Yes" }, { label: "No" }],
        },
      ]),
    ).toBeUndefined();
    // Multi-select can express more than one answer — generic flow.
    expect(
      planReviewOf([
        {
          id: "plan",
          question: "Proceed?",
          detail: "the plan",
          intent: { kind: "plan-review", approve: "Approve" },
          options: [{ label: "Approve" }],
          multiSelect: true,
        },
      ]),
    ).toBeUndefined();
  });
});
