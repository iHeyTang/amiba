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

  it("expands to the raw body as plain preformatted text, never as markdown", async () => {
    render(withLabel(<Bubble m={report} />));

    const row = screen.getByRole("button");
    expect(row).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");

    // A notice is a machine account, not prose — no markdown parsing at all,
    // so a pipe table stays literal pipe characters, not an actual <table>.
    expect(screen.queryByRole("table")).toBeNull();
    const pre = screen.getByTestId("message-notice").parentElement!.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveTextContent("| 项目 | 状态 |");
    // Preformatted, small, muted — the same quiet chrome a tool call's
    // expanded output uses, not the document face.
    expect(pre).toHaveClass("whitespace-pre-wrap", "font-mono", "text-[10.5px]");
  });

  it("never turns a title-line-plus-`---` body into a giant heading", async () => {
    // The reported bug: a notice body whose first line is a title followed
    // by a bare `---` is legitimate machine-account text, but a markdown
    // renderer reads that `---` as a setext heading underline.
    const goldReport: UiMessage = {
      uiId: "dsh:n2",
      role: "user",
      content: "【任务汇报】查询今日黄金价格（task: t2）\n---\n完成，金价为 700 元/克",
      origin: { kind: "plugin", plugin: "amiba-steward" },
      notice: { summary: "任务汇报：查询今日黄金价格 — 完成" },
    };
    render(withLabel(<Bubble m={goldReport} />));

    await userEvent.click(screen.getByRole("button"));

    expect(screen.queryByRole("heading")).toBeNull();
    const pre = screen.getByTestId("message-notice").parentElement!.querySelector("pre");
    expect(pre).toHaveTextContent("【任务汇报】查询今日黄金价格（task: t2） --- 完成，金价为 700 元/克");
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
