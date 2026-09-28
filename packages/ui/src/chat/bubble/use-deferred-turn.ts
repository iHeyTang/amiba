import { useEffect, useRef, useState } from "react";

const heights = new WeakMap<object, Map<string, number>>();
const MAX_SAVED_HEIGHTS = 512;

/** Keep visited content mounted; defer only its first creation on this visit. */
export function useDeferredTurn(scope: object | undefined, id: string, deferred: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(!deferred);
  const ready = !scope || !deferred || revealed || typeof IntersectionObserver === "undefined";
  const height = scope ? heights.get(scope)?.get(id) ?? 160 : 160;

  useEffect(() => { if (!deferred) setRevealed(true); }, [deferred]);

  useEffect(() => {
    const node = ref.current;
    if (!node || ready) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setRevealed(true);
      observer.disconnect();
    }, { root: node.closest("[data-conversation-scroll]"), rootMargin: "1000px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !ready || !scope || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect.height;
      // Hidden panels and placeholders must never replace the measured size.
      if (!size || size <= 0) return;
      let saved = heights.get(scope);
      if (!saved) { saved = new Map(); heights.set(scope, saved); }
      saved.delete(id);
      saved.set(id, size);
      if (saved.size > MAX_SAVED_HEIGHTS) saved.delete(saved.keys().next().value!);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready, scope, id]);

  return { ref, ready, height };
}
