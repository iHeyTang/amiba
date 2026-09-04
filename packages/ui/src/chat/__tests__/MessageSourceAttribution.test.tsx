import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${String(params.source)}` : key,
  }),
}));

import { Bubble, MessageSourceLabelContext } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

const relayed: UiMessage = {
  uiId: "dsh:m1",
  role: "user",
  content: "帮我看下这个任务",
  origin: { kind: "plugin", plugin: "amiba-steward" },
};

describe("plugin-dispatched user message attribution", () => {
  it("names the producer through the registered label", () => {
    render(
      <MessageSourceLabelContext.Provider
        value={(id) => (id === "amiba-steward" ? "大管家" : undefined)}
      >
        <Bubble m={relayed} />
      </MessageSourceLabelContext.Provider>,
    );
    expect(screen.getByTestId("message-source")).toHaveTextContent(
      "sidepanel.message.from:大管家",
    );
    expect(screen.getByText("帮我看下这个任务")).toBeInTheDocument();
  });

  it("falls back to the raw plugin id when nothing registered it", () => {
    render(
      <MessageSourceLabelContext.Provider value={() => undefined}>
        <Bubble m={relayed} />
      </MessageSourceLabelContext.Provider>,
    );
    expect(screen.getByTestId("message-source")).toHaveTextContent(
      "sidepanel.message.from:amiba-steward",
    );
  });

  it("renders no attribution on a message the person typed", () => {
    render(<Bubble m={{ uiId: "u1", role: "user", content: "hello" }} />);
    expect(screen.queryByTestId("message-source")).toBeNull();
  });
});
