import { useLayoutEffect, useRef, type RefObject } from "react";

/** Follow new output until the reader scrolls up; resume on returning to the bottom. */
export function useConversationAutoScroll(
  viewportRef: RefObject<HTMLDivElement>,
  sessionId: string | null | undefined,
  content: unknown,
  bottomClearance: number,
) {
  const following = useRef(true);
  const lastTop = useRef(0);

  useLayoutEffect(() => {
    following.current = true;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
    lastTop.current = viewport.scrollTop;

    const onWheel = (event: WheelEvent) => {
      // Pause before the browser dispatches scroll, so an arriving chunk
      // cannot undo the user's first upward gesture.
      if (event.deltaY < 0) following.current = false;
    };
    const onScroll = () => {
      const top = viewport.scrollTop;
      if (top < lastTop.current) following.current = false;
      else if (top > lastTop.current) {
        following.current =
          viewport.scrollHeight - top - viewport.clientHeight <= 24;
      }
      lastTop.current = top;
    };
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [viewportRef, sessionId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !following.current) return;
    viewport.scrollTop = viewport.scrollHeight;
    lastTop.current = viewport.scrollTop;
  }, [viewportRef, sessionId, content, bottomClearance]);
}
