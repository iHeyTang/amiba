import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
import { MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";
import type { CompactionProgress } from "@amiba/app-runtime/protocol";

function messages(
  compaction: CompactionProgress,
  streaming = true,
): UiMessage[] {
  return [
    { uiId: "user", role: "user", content: "Continue the task" },
    {
      uiId: "assistant",
      role: "assistant",
      content: "BeforeAfter",
      streaming,
      assistantTimeline: [
        { kind: "text", id: "before", text: "Before" },
        { kind: "compaction", id: "compact", compaction },
        { kind: "text", id: "after", text: "After" },
      ],
    },
  ];
}

describe("conversation compaction row", () => {
  it("updates one visible row in place and keeps the completed checkpoint expandable", () => {
    const running: CompactionProgress = {
      compactionId: "c1",
      status: "running",
    };
    const { container, rerender } = render(
      <MessageTurns messages={messages(running)} />,
    );
    expect(screen.getByText("sidepanel.compaction.running")).toBeVisible();
    expect(container.querySelectorAll("[data-compaction-id]")).toHaveLength(1);
    const row = container.querySelector("[data-compaction-id]");
    const completed: CompactionProgress = {
      ...running,
      status: "completed",
      summary: "Retained requirements",
      shadowedItemCount: 10,
      shadowedTokenCount: 20000,
    };
    rerender(<MessageTurns messages={messages(completed, false)} />);
    expect(container.querySelector("[data-compaction-id]")).toBe(row);
    expect(screen.queryByText("sidepanel.compaction.running")).toBeNull();
    expect(screen.getByText("sidepanel.compaction.completed")).toBeVisible();
    expect(row?.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(row!.querySelector("summary")!);
    expect(screen.getByText("Retained requirements")).toBeVisible();
    expect(screen.getByText("Before").compareDocumentPosition(row!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(row!.compareDocumentPosition(screen.getByText("After"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it.each(["failed", "interrupted"] as const)(
    "shows %s without declaring the whole task failed",
    (status) => {
      const { container } = render(
        <MessageTurns
          messages={messages({
            compactionId: "c",
            status,
            error: "summary error",
          })}
        />,
      );
      expect(screen.getByText(`sidepanel.compaction.${status}`)).toBeVisible();
      expect(
        container.querySelector("[data-compaction-status]"),
      ).toHaveAttribute("data-compaction-status", status);
      expect(screen.getByText("After")).toBeVisible();
    },
  );

  it("does not show an endless spinner for a historical start with no live confirmation", () => {
    render(
      <MessageTurns
        messages={messages({ compactionId: "c", status: "running" }, false)}
      />,
    );
    expect(screen.getByText("sidepanel.compaction.unconfirmed")).toBeVisible();
    expect(screen.queryByText("sidepanel.compaction.running")).toBeNull();
  });

  it("renders a compaction-only assistant turn after reload", () => {
    render(
      <MessageTurns
        messages={[
          {
            uiId: "a",
            role: "assistant",
            content: "",
            assistantTimeline: [
              {
                kind: "compaction",
                id: "c",
                compaction: { compactionId: "c", status: "completed" },
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("sidepanel.compaction.completed")).toBeVisible();
  });
});
