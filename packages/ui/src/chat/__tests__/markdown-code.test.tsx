import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMarkdown as Streamdown, MarkdownProvider } from "@amiba/markdown";
import { defaultMarkdown } from "../../../../../plugins/dsh-plugin-markdown/src/client/defaults";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ language: "zh-CN" }) }));
const extensions = [defaultMarkdown];
const components = {};
describe("code wrap actions", () => {
  it("replaces download with an independent, reversible wrap toggle", () => {
    const { container } = renderWithProvider(
      <Streamdown mode="static" components={components}>
        {"```ts\nconst a = 1;\n```\n\n```\nsecond\n```"}
      </Streamdown>,
    );
    const toggles = screen.getAllByRole("button", { name: "自动换行" });
    expect(toggles).toHaveLength(2);

    expect(screen.getAllByRole("button", { name: /复制代码/i })).toHaveLength(
      2,
    );
    fireEvent.click(toggles[0]);
    const blocks = container.querySelectorAll(
      '.amiba-markdown-code',
    );
    expect(blocks[0].closest(".chat-md")).not.toBeNull();
    expect(blocks[0].getAttribute("data-wrap")).toBe("true");
    expect(blocks[1].getAttribute("data-wrap")).toBe("false");
    expect(toggles[0].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggles[0]);
    expect(blocks[0].getAttribute("data-wrap")).toBe("false");
  });
  it("keeps wrap enabled as streaming code grows", () => {
    const { rerender, container } = renderWithProvider(
      <Streamdown components={components}>{"```ts\nconst a"}</Streamdown>,
    );
    fireEvent.click(screen.getByRole("button", { name: "自动换行" }));
    rerender(
      <Streamdown components={components}>
        {"```ts\nconst a = 123;\n```"}
      </Streamdown>,
    );
    expect(
      container
        .querySelector('.amiba-markdown-code')
        ?.getAttribute("data-wrap"),
    ).toBe("true");
    expect(container.textContent).toContain("const a = 123;");
  });
});

function renderWithProvider(node: React.ReactElement) {
  const result = render(
    <MarkdownProvider extensions={extensions}>{node}</MarkdownProvider>,
  );
  return {
    ...result,
    rerender: (next: React.ReactElement) =>
      result.rerender(
        <MarkdownProvider extensions={extensions}>{next}</MarkdownProvider>,
      ),
  };
}
