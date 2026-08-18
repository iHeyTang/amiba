import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { ClarifyBanner } from "../bubble/clarify";

describe("ClarifyBanner", () => {
  it("collects every question in a DSH batch before responding", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Code/ }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "sidepanel.clarify.customAnswer 2",
      }),
      { target: { value: "Document the migration" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "sidepanel.clarify.send" }),
    );

    expect(onRespond).toHaveBeenCalledWith([
      { id: "target", selected: ["Code"] },
      { id: "note", selected: [], custom: "Document the migration" },
    ]);
    expect(screen.getByText("Change source")).toBeInTheDocument();
  });
});
