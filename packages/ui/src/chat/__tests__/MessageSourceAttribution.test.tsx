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

  it("uses a readable fallback when the producer is unavailable", () => {
    render(
      <MessageSourceLabelContext.Provider value={() => undefined}>
        <Bubble m={relayed} />
      </MessageSourceLabelContext.Provider>,
    );
    expect(screen.getByTestId("message-source")).toHaveTextContent(
      "sidepanel.message.from:sidepanel.message.otherApp",
    );
  });

  it("renders readable attribution on historical connector messages", () => {
    const plugin = "amiba-message:channel-7976c4c1-4387-4820-8b02-3803431d4c93";
    render(<MessageSourceLabelContext.Provider value={id => id === plugin ? "飞书 · 工作账号" : undefined}>
      <Bubble m={{ ...relayed, origin: { kind: "plugin", plugin } }} />
    </MessageSourceLabelContext.Provider>);
    expect(screen.getByTestId("message-source")).toHaveTextContent("sidepanel.message.from:飞书 · 工作账号");
    expect(screen.queryByText(/7976c4c1/)).toBeNull();
  });

  it("renders no attribution on a message the person typed", () => {
    render(<Bubble m={{ uiId: "u1", role: "user", content: "hello" }} />);
    expect(screen.queryByTestId("message-source")).toBeNull();
  });
});

it("shows distinct sender nicknames for messages from the same group connection", () => {
  render(<MessageSourceLabelContext.Provider value={() => "钉钉 · 工作账号"}>
    <Bubble m={{ ...relayed, uiId: "one", origin: { kind: "plugin", plugin: "channel", senderName: "张三" } }} />
    <Bubble m={{ ...relayed, uiId: "two", origin: { kind: "plugin", plugin: "channel", senderName: "李四" } }} />
  </MessageSourceLabelContext.Provider>);
  expect(screen.getAllByTestId("message-source").map(element => element.textContent)).toEqual([
    "sidepanel.message.from:钉钉 · 工作账号 · 张三", "sidepanel.message.from:钉钉 · 工作账号 · 李四",
  ]);
});
