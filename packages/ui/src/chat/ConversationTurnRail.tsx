import { useT } from "@amiba/i18n";
import {
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
import {
  bubbleTextContent,
  stripManagedResourceContext,
} from "./internal/helpers";
import type { UiMessage } from "./internal/types";

const RAIL_LEFT_PX = 8; // matches `left-2` on the rail nav
const RAIL_WIDTH_PX = 24; // matches `w-6` on the rail nav
const MIN_CONTENT_GAP_PX = 16;

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

export function ConversationTurnRail({
  messages,
  viewportRef,
  contentRef,
  containerRef,
}: {
  messages: UiMessage[];
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useT();
  const userMessages = useMemo(
    () =>
      messages.filter(
        // Only messages that actually START a user turn belong on the rail.
        // The bubble renderer starts a turn for a user-role message unless it
        // carries a `notice` — a plugin's one-off account of something that
        // just happened (a background task report, a guard's reminder), which
        // renders as a collapsed context row instead of a user bubble. The
        // rail must mirror that rule or its markers — and their 1:1 alignment
        // with the DOM turns below — drift.
        (message) => message.role === "user" && !message.notice,
      ),
    [messages],
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
    if (!viewport || !content || userMessages.length === 0) return;

    const turns = Array.from(
      content.querySelectorAll<HTMLElement>("[data-conversation-user-turn]"),
    );
    if (turns.length === 0) return;

    const readingLine =
      viewport.scrollTop + Math.min(112, viewport.clientHeight * 0.2);
    let nextIndex = 0;
    for (let index = 0; index < turns.length; index += 1) {
      if ((turns[index]?.offsetTop ?? 0) <= readingLine) nextIndex = index;
      else break;
    }
    if (
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
      2
    ) {
      nextIndex = turns.length - 1;
    }
    setActiveIndex(nextIndex);
  }, [contentRef, userMessages.length, viewportRef]);

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
  }, [contentRef, updateActiveTurn, viewportRef]);

  const jumpToTurn = useCallback(
    (index: number) => {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      const turn = content?.querySelectorAll<HTMLElement>(
        "[data-conversation-user-turn]",
      )[index];
      if (!viewport || !turn) return;

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      viewport.scrollTo({
        top: Math.max(0, turn.offsetTop - 8),
        behavior: reduceMotion ? "auto" : "smooth",
      });
      setActiveIndex(index);
    },
    [contentRef, viewportRef],
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

  if (userMessages.length === 0 || !hasContentClearance) return null;

  return (
    <nav
      data-conversation-turn-rail
      aria-label={t("conversationRail.label")}
      className="pointer-events-none absolute inset-y-3 left-2 z-30 flex w-6 flex-col"
    >
      <TooltipProvider delayDuration={120} skipDelayDuration={80}>
        <div
          ref={markersRef}
          data-conversation-turn-markers
          className="m-auto flex max-h-full w-full flex-col gap-px overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {userMessages.map((message, index) => {
            const active = index === activeIndex;
            const preview =
              messagePreview(message) || t("conversationRail.messageFallback");
            const distanceFromActive = Math.abs(index - activeIndex);
            const distanceFromHover =
              hoveredIndex === null ? null : Math.abs(index - hoveredIndex);

            return (
              <Tooltip key={message.uiId}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-conversation-turn-marker
                    aria-current={active ? "location" : undefined}
                    aria-label={t("conversationRail.jumpTo", {
                      index: index + 1,
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
