import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock("@amiba/ui/primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@amiba/ui/primitives")>();
  return {
    ...actual,
    TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
    TooltipContent: () => null,
  };
});

import { MessageTurns } from "../bubble/Bubble";
import { STREAMING_PLAIN_TEXT } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

const streamingReply = (overrides: Partial<UiMessage> = {}): UiMessage => ({
  uiId: "reply",
  role: "assistant",
  content: "",
  streaming: true,
  ...overrides,
});

describe("streaming body rendering", () => {
  it("renders the raw text while a reply streams, then markdown once it settles", () => {
    if (!STREAMING_PLAIN_TEXT) return;
    const markdown = "# 标题\n\n这是 **加粗** 和 `code`。";
    const { rerender, container } = render(
      <MessageTurns
        messages={[
          { uiId: "prompt", role: "user", content: "问" },
          streamingReply({ content: markdown, streaming: true }),
        ]}
      />,
    );
    // Streaming: plain pre-wrap text, no markdown elements.
    const plain = container.querySelector("[data-streaming-plain-text]");
    expect(plain).not.toBeNull();
    expect(plain!.textContent).toContain("# 标题");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();

    // Settled: markdown renders.
    rerender(
      <MessageTurns
        messages={[
          { uiId: "prompt", role: "user", content: "问" },
          streamingReply({ content: markdown, streaming: false }),
        ]}
      />,
    );
    expect(container.querySelector("[data-streaming-plain-text]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "标题" })).not.toBeNull();
    expect(container.querySelector("[data-streamdown='strong']")).not.toBeNull();
  });

  it("stays plain while streaming even with code fences", () => {
    if (!STREAMING_PLAIN_TEXT) return;
    const { container } = render(
      <MessageTurns
        messages={[
          { uiId: "prompt", role: "user", content: "问" },
          streamingReply({ content: "```ts\nconst a" }),
        ]}
      />,
    );
    const plain = container.querySelector("[data-streaming-plain-text]");
    expect(plain?.textContent).toContain("```ts");
    expect(container.querySelector(".amiba-markdown-code")).toBeNull();
  });
});