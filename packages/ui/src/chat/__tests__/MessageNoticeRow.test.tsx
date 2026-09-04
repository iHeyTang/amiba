import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${String(params.source)}` : key,
  }),
}));

import { Bubble, MessageSourceLabelContext } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

/**
 * A `notice` — an account of something that happened, not a turn somebody
 * took. The steward's task report is the motivating one: it arrives as a
 * user-role message because that is where the model reads it, but nobody
 * said it to anybody, and its body is a markdown document.
 */
const report: UiMessage = {
  uiId: "dsh:n1",
  role: "user",
  content:
    "【任务汇报】写周报（task: t1）\n\n| 项目 | 状态 |\n| --- | --- |\n| 周报 | 完成 |",
  origin: { kind: "plugin", plugin: "amiba-steward" },
  notice: { summary: "任务汇报：写周报 — 完成" },
};

const withLabel = (node: React.ReactNode) => (
  <MessageSourceLabelContext.Provider
    value={(id) => (id === "amiba-steward" ? "大管家" : undefined)}
  >
    {node}
  </MessageSourceLabelContext.Provider>
);

describe("a notice renders as a collapsed context row, not a user bubble", () => {
  it("shows the producer and its one-line summary, and nothing else", () => {
    render(withLabel(<Bubble m={report} />));

    expect(screen.getByTestId("message-notice")).toHaveTextContent(
      "大管家 · 任务汇报：写周报 — 完成",
    );
    // The body stays behind the disclosure until it is opened.
    expect(screen.queryByText(/【任务汇报】写周报/)).toBeNull();
  });

  it("never wears the user bubble's attribution chip", () => {
    // The chip reads "from 大管家" on a message the user is being shown as
    // having said. A report was said to nobody, so the chip would be a lie.
    render(withLabel(<Bubble m={report} />));
    expect(screen.queryByTestId("message-source")).toBeNull();
  });

  it("falls back to the raw plugin id when nothing registered it", () => {
    render(
      <MessageSourceLabelContext.Provider value={() => undefined}>
        <Bubble m={report} />
      </MessageSourceLabelContext.Provider>,
    );
    expect(screen.getByTestId("message-notice")).toHaveTextContent(
      "amiba-steward · 任务汇报：写周报 — 完成",
    );
  });

  it("expands to the full body rendered as markdown", async () => {
    render(withLabel(<Bubble m={report} />));

    const row = screen.getByRole("button");
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");

    // The same renderer the assistant body uses, so a report's tables are
    // tables rather than a wall of pipes.
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "周报" })).toBeInTheDocument();
  });

  it("still renders a relayed message as a user bubble with its chip", () => {
    // A `relay` was addressed TO this session — that IS a turn, and the
    // notice row must not swallow it.
    render(
      withLabel(
        <Bubble
          m={{
            uiId: "dsh:m1",
            role: "user",
            content: "帮我看下这个任务",
            origin: { kind: "plugin", plugin: "amiba-steward" },
          }}
        />,
      ),
    );
    expect(screen.getByTestId("message-source")).toHaveTextContent(
      "sidepanel.message.from:大管家",
    );
    expect(screen.getByText("帮我看下这个任务")).toBeInTheDocument();
    expect(screen.queryByTestId("message-notice")).toBeNull();
  });
});
