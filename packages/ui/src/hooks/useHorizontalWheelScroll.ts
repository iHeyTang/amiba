import { useCallback, useRef } from "react";

/**
 * Let a vertical wheel scroll a horizontally-overflowing rail.
 *
 * A tab rail only overflows sideways, but a mouse wheel only emits `deltaY`,
 * so without this the rail is unreachable to anyone without a trackpad or a
 * tilt wheel. Trackpads already emit `deltaX` for horizontal intent and the
 * browser applies it natively, so a dominant horizontal delta is left alone.
 *
 * Two things force the shape of this hook:
 *
 * 1. The listener is attached natively rather than through React's `onWheel`:
 *    React registers `wheel` at the root as a PASSIVE listener, where
 *    `preventDefault()` is a no-op and warns. Without preventing the default
 *    the gesture would also chain to a scrollable ancestor.
 * 2. It returns a CALLBACK ref, not an object ref. Rails are conditionally
 *    rendered — the workbench tab strip only exists once a session or a tab
 *    does, long after the pane first mounts. An object ref read from a
 *    mount-time effect would find `null` and never rebind; a callback ref
 *    fires exactly when the node appears and again when it goes away.
 */
export function useHorizontalWheelScroll<T extends HTMLElement>(): (
  node: T | null,
) => void {
  const detachRef = useRef<(() => void) | null>(null);

  return useCallback((node: T | null) => {
    detachRef.current?.();
    detachRef.current = null;
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      // Nothing to scroll: let the gesture chain to whatever is behind.
      if (node.scrollWidth <= node.clientWidth) return;
      // Horizontal intent — the browser handles it correctly already.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      const before = node.scrollLeft;
      node.scrollLeft = before + event.deltaY;
      // Only swallow the gesture if it actually moved the rail; at either end
      // the wheel should still reach an ancestor instead of dying here.
      if (node.scrollLeft !== before) event.preventDefault();
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    detachRef.current = () => node.removeEventListener("wheel", onWheel);
  }, []);
}
