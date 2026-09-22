import { useLayoutEffect, useRef, type RefObject } from "react";

type Position = { top: number; following: boolean };
const positions = new WeakMap<object, Map<string, Position>>();

/** Preserve each reader's position independently of the mounted conversation. */
export function useConversationAutoScroll(
  viewportRef: RefObject<HTMLDivElement>,
  sessionId: string | null | undefined,
  content: unknown,
  bottomClearance: number,
  scope: object = viewportRef,
) {
  const following = useRef(true);
  const lastTop = useRef(0);
  const restore = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !sessionId) return;
    let sessions = positions.get(scope);
    if (!sessions) { sessions = new Map(); positions.set(scope, sessions); }
    const saved = sessions.get(sessionId);
    following.current = saved?.following ?? true;
    let pendingTop = saved && !saved.following ? saved.top : null;
    const remember = () => sessions!.set(sessionId, {
      top: pendingTop ?? lastTop.current, following: following.current,
    });
    const reconcile = () => {
      // Hidden panels have no layout. Wait for visibility/content to return.
      if (!viewport.clientHeight) return;
      if (following.current) viewport.scrollTop = viewport.scrollHeight;
      else if (pendingTop !== null) {
        viewport.scrollTop = pendingTop;
        if (viewport.scrollHeight - viewport.clientHeight >= pendingTop) pendingTop = null;
      }
      lastTop.current = viewport.scrollTop;
      remember();
    };
    restore.current = reconcile;
    reconcile();
    const onWheel = (event: WheelEvent) => {
      pendingTop = null;
      if (event.deltaY < 0) following.current = false;
      remember();
    };
    const onScroll = () => {
      if (!viewport.clientHeight) return;
      const top = viewport.scrollTop;
      if (top < lastTop.current) { following.current = false; pendingTop = null; }
      else if (top > lastTop.current) {
        pendingTop = null;
        following.current = viewport.scrollHeight - top - viewport.clientHeight <= 24;
      }
      lastTop.current = top;
      remember();
    };
    viewport.addEventListener("wheel", onWheel, { passive: true });
    viewport.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(reconcile);
    observer?.observe(viewport);
    if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
    return () => {
      remember();
      restore.current = null;
      observer?.disconnect();
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [viewportRef, sessionId, scope]);

  useLayoutEffect(() => {
    restore.current?.();
  }, [viewportRef, sessionId, content, bottomClearance, scope]);
}
