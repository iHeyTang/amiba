import { useT } from "@amiba/i18n";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "../primitives";
import type { ConversationTurn } from "./bubble/Bubble";
import {
  bubbleTextContent,
  stripManagedResourceContext,
} from "./internal/helpers";
import type { UiMessage } from "./internal/types";

const RAIL_LEFT_PX = 8; // matches `left-2` on the rail nav
const RAIL_WIDTH_PX = 24; // matches `w-6` on the rail nav
const MIN_CONTENT_GAP_PX = 16;
// Landing a jump target a few pixels below the viewport top keeps the sticky
// user bubble clear of the edge instead of butting flush against it.
const JUMP_TOP_MARGIN_PX = 8;

function visibleMessageText(content: unknown): string {
  let text = stripManagedResourceContext(bubbleTextContent(content));
  const attachmentEnd = text.toLowerCase().lastIndexOf("</file-attachment>");
  if (attachmentEnd >= 0) {
    text = text.slice(attachmentEnd + "</file-attachment>".length);
  }
  return text;
}

function messagePreview(message: UiMessage): string {
  const text = visibleMessageText(message.content).replace(/\s+/g, " ").trim();
  if (text) return text.length > 160 ? `${text.slice(0, 159)}…` : text;

  const references = [
    ...(message.attachmentBadges ?? []).map((badge) => badge.name),
  ].filter(Boolean);
  return references.join(" · ");
}

function markerOpacity(distanceFromActive: number): number {
  if (distanceFromActive === 0) return 0.78;
  if (distanceFromActive === 1) return 0.54;
  if (distanceFromActive === 2) return 0.36;
  return 0.22;
}

function markerWidthClass(distanceFromHover: number | null): string {
  if (distanceFromHover === 0) return "w-4";
  if (distanceFromHover === 1) return "w-3.5";
  if (distanceFromHover === 2) return "w-3";
  return "w-2.5";
}

/**
 * The vertical scroll coordinate of `element` inside `viewport`, independent
 * of whichever ancestor happens to be the element's offsetParent. The turn
 * rows live inside a Radix ScrollArea viewport under several positioned
 * wrappers; `offsetTop` is meaningless across those, while this rect-based
 * measurement is exact for every rendered turn (the message list only renders
 * a window of turns, so forcing layout of the handful in the DOM is cheap).
 */
function scrollCoordinateOf(
  element: HTMLElement,
  viewport: HTMLElement,
): number {
  const viewportRect = viewport.getBoundingClientRect();
  return (
    element.getBoundingClientRect().top -
    viewportRect.top +
    viewport.scrollTop
  );
}

function ConversationTurnRailUnmemoized({
  turns,
  viewportRef,
  contentRef,
  containerRef,
}: {
  /**
   * The turn window the bubble renderer currently has in the DOM. Only turns
   * in here can have markers: long histories are windowed, so any marker for
   * a turn outside this list would neither highlight nor jump anywhere.
   */
  turns: readonly ConversationTurn[];
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useT();
  // One marker per rendered turn that carries a user prompt. Assistant-only
  // rows (a host-started reply) get no marker; markers stay 1:1 with the DOM
  // turns below because MessageTurns groups the same way (a user-role notice
  // never starts a turn and is folded into the current turn's replies).
  const markers = useMemo(
    () => turns.filter((turn): turn is ConversationTurn & { user: UiMessage } => turn.user != null),
    [turns],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hasContentClearance, setHasContentClearance] = useState(false);
  const frameRef = useRef<number | null>(null);

  const updateContentClearance = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      setHasContentClearance(false);
      return;
    }

    const contentPaddingLeft =
      Number.parseFloat(window.getComputedStyle(content).paddingLeft) || 0;
    const contentStart =
      content.getBoundingClientRect().left + contentPaddingLeft;
    const railRight =
      container.getBoundingClientRect().left + RAIL_LEFT_PX + RAIL_WIDTH_PX;
    setHasContentClearance(contentStart - railRight >= MIN_CONTENT_GAP_PX);
  }, [containerRef, contentRef]);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    updateContentClearance();
    const resizeObserver = new ResizeObserver(updateContentClearance);
    resizeObserver.observe(container);
    resizeObserver.observe(content);
    window.addEventListener("resize", updateContentClearance);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateContentClearance);
    };
  }, [containerRef, contentRef, updateContentClearance]);

  const updateActiveTurn = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || markers.length === 0) return;

    const domTurns = Array.from(
      content.querySelectorAll<HTMLElement>("[data-conversation-user-turn]"),
    );
    if (domTurns.length === 0) return;

    // Address DOM turns by their user-message uiId instead of positional
    // index: assistant-only rows sit between user turns in the DOM, so a
    // count-based mapping would drift the highlight.
    const markerIndexByUiId = new Map<string, number>();
    markers.forEach((marker, index) =>
      markerIndexByUiId.set(marker.user.uiId, index),
    );

    const readingLine =
      viewport.scrollTop + Math.min(112, viewport.clientHeight * 0.2);
    // The marker of the most recent user turn at or above the reading line.
    // Starts at the first marker so a window opening with only assistant-only
    // rows above the line still has a sensible highlight.
    let current = 0;
    for (const turn of domTurns) {
      // A turn below the reading line has not been read yet: break BEFORE it
      // could claim its marker, keeping the highlight on the previous user
      // turn.
      if (scrollCoordinateOf(turn, viewport) > readingLine) break;
      const userUiId = turn.getAttribute("data-conversation-user-turn");
      const mapped = userUiId ? markerIndexByUiId.get(userUiId) : undefined;
      if (mapped !== undefined) current = mapped;
    }
    // Pinned to the bottom (auto-scroll following a live stream, or the
    // reader at the end of the history): the newest rendered turn wins, even
    // when the final turn is short enough to sit above the reading line.
    if (
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
      2
    ) {
      current = markers.length - 1;
    }
    setActiveIndex(current);
  }, [contentRef, markers, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const scheduleUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateActiveTurn();
      });
    };

    scheduleUpdate();
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);

    return () => {
      viewport.removeEventListener("scroll", scheduleUpdate);
      resizeObserver.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // `markers` changes when the conversation switches or the turn window
    // expands; re-evaluate so a freshly opened session starts with the marker
    // of the turn actually on screen (the tail), not whatever the previous
    // conversation left highlighted.
  }, [contentRef, markers, updateActiveTurn, viewportRef]);

  const jumpToTurn = useCallback(
    (index: number) => {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      const marker = markers[index];
      if (!viewport || !content || !marker) return;

      // Resolve by uiId: the DOM turn for this marker is always rendered
      // (markers only cover the rendered window), but positional indexing
      // could hit an assistant-only row sitting between user turns.
      let turn: HTMLElement | null = null;
      for (const candidate of content.querySelectorAll<HTMLElement>(
        "[data-conversation-user-turn]",
      )) {
        if (
          candidate.getAttribute("data-conversation-user-turn") ===
          marker.user.uiId
        ) {
          turn = candidate;
          break;
        }
      }
      if (!turn) return;

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      viewport.scrollTo({
        top: Math.max(
          0,
          scrollCoordinateOf(turn, viewport) - JUMP_TOP_MARGIN_PX,
        ),
        behavior: reduceMotion ? "auto" : "smooth",
      });
      setActiveIndex(index);
    },
    [contentRef, markers, viewportRef],
  );

  const markersRef = useRef<HTMLDivElement | null>(null);

  // When the marker list outgrows the rail it scrolls on its own; keep the
  // row for the current reading position visible instead of letting it slip
  // out of the clipped window. `block: "nearest"` never jumps the list for a
  // marker that is already in view.
  useEffect(() => {
    const marker = markersRef.current?.children[activeIndex];
    if (marker instanceof HTMLElement) {
      marker.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeIndex]);

  if (markers.length === 0 || !hasContentClearance) return null;

  return (
    <nav
      data-conversation-turn-rail
      aria-label={t("conversationRail.label")}
      // z-40: the composer dock overlays the panel's bottom edge at z-30, and
      // without a higher rail the bottom markers are covered by its
      // full-width (but transparent) hit area and cannot be clicked.
      className="pointer-events-none absolute inset-y-3 left-2 z-40 flex w-6 flex-col"
    >
      <TooltipProvider delayDuration={120} skipDelayDuration={80}>
        <div
          ref={markersRef}
          data-conversation-turn-markers
          className="m-auto flex max-h-full w-full flex-col gap-px overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {markers.map((marker, index) => {
            const active = index === activeIndex;
            const preview =
              messagePreview(marker.user) ||
              t("conversationRail.messageFallback");
            const distanceFromActive = Math.abs(index - activeIndex);
            const distanceFromHover =
              hoveredIndex === null ? null : Math.abs(index - hoveredIndex);

            return (
              <Tooltip key={marker.user.uiId}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-conversation-turn-marker
                    aria-current={active ? "location" : undefined}
                    aria-label={t("conversationRail.jumpTo", {
                      // userOrdinal counts user turns across the WHOLE
                      // history, so numbering stays truthful even when the
                      // window only renders the newest slice.
                      index: marker.userOrdinal + 1,
                      message: preview,
                    })}
                    onClick={() => jumpToTurn(index)}
                    onPointerEnter={() => setHoveredIndex(index)}
                    onPointerLeave={() => setHoveredIndex(null)}
                    onFocus={() => setHoveredIndex(index)}
                    onBlur={() => setHoveredIndex(null)}
                    className="pointer-events-auto relative flex h-2 w-6 shrink-0 items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <span
                      aria-hidden
                      data-conversation-turn-stroke
                      className={cn(
                        "h-[2px] rounded-full bg-foreground transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none",
                        markerWidthClass(distanceFromHover),
                      )}
                      style={{ opacity: markerOpacity(distanceFromActive) }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  align="center"
                  className="max-w-[min(20rem,calc(100vw-7rem))] text-left text-[11px] leading-[1.5]"
                  side="right"
                  sideOffset={6}
                >
                  <span className="line-clamp-3">{preview}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </nav>
  );
}

// The rail's props (windowed turns + stable refs) do not change while a reply
// streams, so memoizing it stops ChatSurface's per-flush re-renders from
// re-reconciling the rail markers on every frame.
export const ConversationTurnRail = memo(ConversationTurnRailUnmemoized);
