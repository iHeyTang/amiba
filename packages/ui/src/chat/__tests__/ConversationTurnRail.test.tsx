import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key === "conversationRail.jumpTo"
        ? `Jump ${values?.index}: ${values?.message}`
        : key,
  }),
}));

import { ConversationTurnRail } from "../ConversationTurnRail";
import type { UiMessage } from "../internal/types";

const messages = [
  {
    uiId: "user-1",
    role: "user",
    content: "Inspect the workspace structure",
  },
  {
    uiId: "assistant-1",
    role: "assistant",
    content: "I will inspect it.",
  },
  {
    uiId: "user-2",
    role: "user",
    content: "Now simplify the file result card",
  },
] as UiMessage[];

function elementRect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 600,
    width,
    height: 600,
    toJSON: () => ({}),
  };
}

function Harness({
  railMessages = messages,
  contentLeft = 80,
}: {
  railMessages?: UiMessage[];
  contentLeft?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // DOM turns mirror the bubble renderer's turn grouping: a user-role
  // message starts a turn unless it carries a `notice` (a plugin's account
  // of a background task, rendered as a collapsed context row instead).
  const userMessages = railMessages.filter(
    (message) => message.role === "user" && !message.notice,
  );
  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        if (node) {
          node.getBoundingClientRect = () => elementRect(0, 1200);
        }
      }}
    >
      <div ref={viewportRef} data-testid="viewport">
        <div
          ref={(node) => {
            contentRef.current = node;
            if (node) {
              node.style.paddingLeft = "12px";
              node.getBoundingClientRect = () => elementRect(contentLeft, 768);
            }
          }}
        >
          {userMessages.map((message) => (
            <div
              key={message.uiId}
              data-conversation-user-turn={message.uiId}
            />
          ))}
        </div>
      </div>
      <ConversationTurnRail
        messages={railMessages}
        viewportRef={viewportRef}
        contentRef={contentRef}
        containerRef={containerRef}
      />
    </div>
  );
}

describe("ConversationTurnRail", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  it("maps every user message to a navigable marker with its preview", async () => {
    render(<Harness />);

    const rail = await screen.findByRole("navigation", {
      name: "conversationRail.label",
    });
    expect(rail).toBeInTheDocument();
    const markersHost = rail.querySelector("[data-conversation-turn-markers]");
    expect(markersHost).toHaveClass("m-auto");
    expect(markersHost).toHaveClass("max-h-full");
    expect(markersHost).toHaveClass("overflow-y-auto");
    expect(markersHost).toHaveClass("gap-px");
    expect(screen.getAllByRole("button", { name: /^Jump/ })).toHaveLength(2);
    for (const marker of screen.getAllByRole("button", { name: /^Jump/ })) {
      expect(marker).not.toHaveAttribute("style");
    }
    const markers = screen.getAllByRole("button", { name: /^Jump/ });
    await userEvent.hover(markers[0]!);
    await waitFor(() =>
      expect(
        document.querySelector('[data-ui-overlay="tooltip"]'),
      ).toHaveTextContent("Inspect the workspace structure"),
    );
  });

  it("hides when the panel edge cannot preserve space before the content", async () => {
    const view = render(<Harness contentLeft={80} />);
    await screen.findByRole("navigation", {
      name: "conversationRail.label",
    });

    view.rerender(<Harness contentLeft={20} />);
    fireEvent(window, new Event("resize"));

    await waitFor(() =>
      expect(
        screen.queryByRole("navigation", {
          name: "conversationRail.label",
        }),
      ).not.toBeInTheDocument(),
    );
  });

  it("scrolls to a selected user turn and marks it current", async () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const turn = document.querySelectorAll<HTMLElement>(
      "[data-conversation-user-turn]",
    )[1]!;
    Object.defineProperty(turn, "offsetTop", {
      configurable: true,
      value: 480,
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    await userEvent.click(markers[1]!);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 472,
      behavior: "smooth",
    });
    expect(markers[1]).toHaveAttribute("aria-current", "location");
  });

  it("tracks the user turn crossing the reading line while scrolling", async () => {
    render(<Harness />);
    const viewport = screen.getByTestId("viewport");
    const turns = document.querySelectorAll<HTMLElement>(
      "[data-conversation-user-turn]",
    );
    Object.defineProperty(turns[0], "offsetTop", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(turns[1], "offsetTop", {
      configurable: true,
      value: 420,
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 380 },
    });

    fireEvent.scroll(viewport);

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    await waitFor(() =>
      expect(markers[1]).toHaveAttribute("aria-current", "location"),
    );
  });

  it("uses color for reading position and width only for hover proximity", async () => {
    const railMessages = Array.from({ length: 5 }, (_, index) => ({
      uiId: `user-${index + 1}`,
      role: "user" as const,
      content: `Message ${index + 1}`,
    })) as UiMessage[];
    render(<Harness railMessages={railMessages} />);

    const viewport = screen.getByTestId("viewport");
    const turns = document.querySelectorAll<HTMLElement>(
      "[data-conversation-user-turn]",
    );
    turns.forEach((turn, index) => {
      Object.defineProperty(turn, "offsetTop", {
        configurable: true,
        value: index * 100,
      });
    });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 140 },
    });
    fireEvent.scroll(viewport);

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    await waitFor(() =>
      expect(markers[2]).toHaveAttribute("aria-current", "location"),
    );
    const strokes = markers.map((marker) =>
      marker.querySelector<HTMLElement>("[data-conversation-turn-stroke]"),
    );

    for (const stroke of strokes) expect(stroke).toHaveClass("w-2.5");
    expect(strokes.map((stroke) => stroke?.style.opacity)).toEqual([
      "0.36",
      "0.54",
      "0.78",
      "0.54",
      "0.36",
    ]);

    await userEvent.hover(markers[2]!);
    expect(strokes[0]).toHaveClass("w-3");
    expect(strokes[1]).toHaveClass("w-3.5");
    expect(strokes[2]).toHaveClass("w-4");
    expect(strokes[3]).toHaveClass("w-3.5");
    expect(strokes[4]).toHaveClass("w-3");

    await userEvent.unhover(markers[2]!);
    for (const stroke of strokes) expect(stroke).toHaveClass("w-2.5");
  });

  it("ignores plugin notices (background task rows) and keeps markers aligned to real turns", async () => {
    const railMessages = [
      {
        uiId: "user-1",
        role: "user",
        content: "First prompt",
      },
      {
        uiId: "notice-1",
        role: "user",
        content: "",
        notice: { summary: "任务汇报：写周报 — 完成" },
      },
      {
        uiId: "assistant-1",
        role: "assistant",
        content: "Done.",
      },
      {
        uiId: "user-2",
        role: "user",
        content: "Second prompt",
      },
      {
        uiId: "notice-2",
        role: "user",
        content: "",
        notice: { summary: "guarded reminder" },
      },
    ] as UiMessage[];
    render(<Harness railMessages={railMessages} />);

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    // Only the two real user messages become markers; the notices do not.
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveAttribute("aria-label", "Jump 1: First prompt");
    expect(markers[1]).toHaveAttribute("aria-label", "Jump 2: Second prompt");

    // Marker N still addresses DOM turn N — the notice rows never shift the
    // alignment, because the same rule feeds both sides.
    const viewport = screen.getByTestId("viewport");
    const turn = document.querySelectorAll<HTMLElement>(
      "[data-conversation-user-turn]",
    )[1]!;
    Object.defineProperty(turn, "offsetTop", {
      configurable: true,
      value: 640,
    });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    await userEvent.click(markers[1]!);
    expect(scrollTo).toHaveBeenCalledWith({
      top: 632,
      behavior: "smooth",
    });
  });
});
