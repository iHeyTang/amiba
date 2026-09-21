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
import type { ConversationTurn } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

function userTurn(
  uiId: string,
  content: string,
  userOrdinal: number,
  opts: { replies?: UiMessage[] } = {},
): ConversationTurn {
  return {
    user: { uiId, role: "user", content },
    replies: opts.replies ?? [],
    userOrdinal,
  };
}

/** An assistant-only row (host-started reply); renders a DOM turn, no marker. */
function hostTurn(uiId: string, replies: UiMessage[] = []): ConversationTurn {
  return { user: null, replies, userOrdinal: -1 };
}

function elementRect(top: number, left: number, width: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    right: left + width,
    top,
    bottom: top + 600,
    width,
    height: 600,
    toJSON: () => ({}),
  };
}

const defaultTurns: ConversationTurn[] = [
  userTurn("user-1", "Inspect the workspace structure", 0),
  hostTurn("host-1", [{ uiId: "host-1", role: "assistant", content: "Host start" } as UiMessage]),
  userTurn("user-2", "Now simplify the file result card", 1),
];

function Harness({
  railTurns = defaultTurns,
  contentLeft = 80,
  turnTops = [],
}: {
  railTurns?: ConversationTurn[];
  contentLeft?: number;
  /** Per-DOM-turn document-space top, indexed by DOM order. */
  turnTops?: number[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={(node) => {
        containerRef.current = node;
        if (node) {
          node.getBoundingClientRect = () => elementRect(0, 0, 1200);
        }
      }}
    >
      <div
        ref={(node) => {
          viewportRef.current = node;
          if (node) {
            node.getBoundingClientRect = () => elementRect(0, 0, 1200);
          }
        }}
        data-testid="viewport"
      >
        <div
          ref={(node) => {
            contentRef.current = node;
            if (node) {
              node.style.paddingLeft = "12px";
              node.getBoundingClientRect = () => elementRect(0, contentLeft, 768);
            }
          }}
        >
          {railTurns.map((turn, index) => (
            <div
              key={turn.user?.uiId ?? `turn-${index}`}
              data-conversation-user-turn={turn.user?.uiId}
              ref={(node) => {
                if (node) {
                  // Real rects are viewport-relative: a turn's document top
                  // shifts up by the current scrollTop. `turnTops` holds the
                  // document-space tops.
                  node.getBoundingClientRect = () =>
                    elementRect(
                      (turnTops[index] ?? 0) -
                        (viewportRef.current?.scrollTop ?? 0),
                      contentLeft,
                      600,
                    );
                }
              }}
            />
          ))}
        </div>
      </div>
      <ConversationTurnRail
        turns={railTurns}
        viewportRef={viewportRef}
        contentRef={contentRef}
        containerRef={containerRef}
      />
    </div>
  );
}

function stubViewport(viewport: HTMLElement, scrollTop: number) {
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 300 },
    scrollHeight: { configurable: true, value: 1000 },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
  return viewport;
}

describe("ConversationTurnRail", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
  });

  it("maps rendered user turns to navigable markers with their preview", async () => {
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
    // The assistant-only row between the user turns gets no marker — markers
    // and DOM user turns stay 1:1.
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

  it("scrolls to the DOM turn addressed by the marker (uiId lookup, skipping assistant-only rows)", async () => {
    render(<Harness turnTops={[0, 100, 200]} />);
    const viewport = stubViewport(screen.getByTestId("viewport"), 0);
    // Model a real scroll: the viewport actually moves, so any position
    // recompute after the jump (the mount rAF, for example) agrees with the
    // marker the user just activated instead of reverting it.
    const scrollTo = vi.fn((opts: { top: number; behavior: ScrollBehavior }) => {
      viewport.scrollTop = opts.top;
    });
    viewport.scrollTo = scrollTo;

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    // user-2 is marker 1 even though a host row sits before it in the DOM —
    // the jump resolves by uiId, not by positional index.
    await userEvent.click(markers[1]!);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 192,
      behavior: "smooth",
    });
    await waitFor(() =>
      expect(markers[1]).toHaveAttribute("aria-current", "location"),
    );
  });

  it("tracks the user turn crossing the reading line while scrolling", async () => {
    render(<Harness turnTops={[0, 100, 420]} />);
    const viewport = stubViewport(screen.getByTestId("viewport"), 380);

    fireEvent.scroll(viewport);

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    await waitFor(() =>
      expect(markers[1]).toHaveAttribute("aria-current", "location"),
    );
  });

  it("keeps the highlight on the preceding user turn while an assistant-only row is at the reading line", async () => {
    const turns: ConversationTurn[] = [
      userTurn("user-A", "A", 0),
      hostTurn("host-1", [{ uiId: "host-1", role: "assistant", content: "" } as UiMessage]),
      userTurn("user-B", "B", 1),
      hostTurn("host-2", [{ uiId: "host-2", role: "assistant", content: "" } as UiMessage]),
      userTurn("user-C", "C", 2),
    ];
    render(<Harness railTurns={turns} turnTops={[0, 100, 200, 300, 400]} />);
    const viewport = stubViewport(screen.getByTestId("viewport"), 150);

    fireEvent.scroll(viewport);

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    // Reading line at 210: user-C (top 400) is below it, the host rows at
    // 100/300 never claim a marker, so user-B (marker 1) stays current.
    stubViewport(viewport, 210);
    fireEvent.scroll(viewport);
    await waitFor(() =>
      expect(markers[1]).toHaveAttribute("aria-current", "location"),
    );
  });

  it("windows long histories: markers only for the rendered slice and the bottom pin highlights the last rendered marker", async () => {
    // A 40-turn conversation whose renderer only mounted the newest 24 turns
    // (user ordinals 16..39) — exactly what MessageTurns does.
    const allTurns: ConversationTurn[] = Array.from({ length: 40 }, (_, i) =>
      userTurn(`u${i}`, `Prompt ${i}`, i),
    );
    const windowedTurns = allTurns.slice(-24);
    render(
      <Harness
        railTurns={windowedTurns}
        turnTops={windowedTurns.map((_, i) => i * 40)}
      />,
    );
    const viewport = stubViewport(
      screen.getByTestId("viewport"),
      1000 - 300,
    );

    fireEvent.scroll(viewport);

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    expect(markers).toHaveLength(24);
    // Numbering stays truthful across the hidden history.
    expect(markers[0]).toHaveAttribute("aria-label", "Jump 17: Prompt 16");
    expect(markers[23]).toHaveAttribute("aria-label", "Jump 40: Prompt 39");
    // Pinned at the bottom: the newest rendered turn is current — NOT an
    // earlier marker from the folded-away history.
    await waitFor(() =>
      expect(markers[23]).toHaveAttribute("aria-current", "location"),
    );
  });

  it("jumps only within the rendered window — every marker addresses a DOM turn", async () => {
    const windowedTurns = Array.from({ length: 24 }, (_, i) =>
      userTurn(`w${i}`, `Prompt ${i}`, i + 16),
    );
    render(
      <Harness
        railTurns={windowedTurns}
        turnTops={windowedTurns.map((_, i) => i * 40)}
      />,
    );
    const viewport = stubViewport(screen.getByTestId("viewport"), 0);
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    await userEvent.click(markers[23]!);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 23 * 40 - 8,
      behavior: "smooth",
    });
  });

  it("re-evaluates the highlight for a freshly opened conversation instead of keeping the old one", async () => {
    const view = render(
      <Harness railTurns={defaultTurns} turnTops={[0, 100, 200]} />,
    );
    const viewport = stubViewport(screen.getByTestId("viewport"), 0);
    // Left the old conversation at the top (marker 0 would be current).
    fireEvent.scroll(viewport);

    // Switch to another conversation, pinned at its bottom.
    const nextTurns = Array.from({ length: 6 }, (_, i) =>
      userTurn(`n${i}`, `Next ${i}`, i),
    );
    view.rerender(
      <Harness
        railTurns={nextTurns}
        turnTops={nextTurns.map((_, i) => i * 40)}
      />,
    );
    stubViewport(viewport, 1000 - 300);
    fireEvent.scroll(viewport);

    const markers = await screen.findAllByRole("button", { name: /^Jump/ });
    await waitFor(() =>
      expect(markers[5]).toHaveAttribute("aria-current", "location"),
    );
    // The old conversation's markers are gone.
    expect(markers.map((m) => m.textContent ?? "")).not.toContain("Inspect");
  });

  it("uses color for reading position and width only for hover proximity", async () => {
    const turns = Array.from({ length: 5 }, (_, index) =>
      userTurn(`user-${index + 1}`, `Message ${index + 1}`, index),
    );
    render(
      <Harness railTurns={turns} turnTops={turns.map((_, i) => i * 100)} />,
    );
    const viewport = stubViewport(screen.getByTestId("viewport"), 140);

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

  it("renders no rail when the rendered slice contains no user turns", async () => {
    render(<Harness railTurns={[hostTurn("host-only")]} />);

    await waitFor(() =>
      expect(
        screen.queryByRole("navigation", {
          name: "conversationRail.label",
        }),
      ).not.toBeInTheDocument(),
    );
  });
});