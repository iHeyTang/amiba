import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
export interface RightbarGeometry { width: number; viewportWidth: number; canShow: boolean }
/** Normal DSH layout requires 300px for the panel and 400px for conversation. */
export function rightbarGeometry(viewportWidth: number, leftWidth: number, preferred: number): RightbarGeometry {
  // Report the room that actually exists. The slot cannot assume that the
  // independently controlled left sidebar has already collapsed.
  const available = Math.max(0, viewportWidth - leftWidth - 400);
  const width = available < 300 ? 0 : Math.min(available, viewportWidth * 0.7, Math.max(300, Math.round(preferred)));
  return { viewportWidth, canShow: width > 0, width };
}
export function RightbarRegion({ leftWidth, width, render, children }: {
  leftWidth: number; width: number;
  render?: (owner: RightbarGeometry, fallback: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 0 : window.innerWidth);
  useLayoutEffect(() => {
    const row = anchor.current?.parentElement;
    const measure = () => setViewportWidth((row?.getBoundingClientRect().width || Math.max(0, window.innerWidth - leftWidth)) + leftWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (row) observer?.observe(row);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [leftWidth]);
  return <>{render ? render(rightbarGeometry(viewportWidth, leftWidth, width), children) : children}<span hidden ref={anchor} /></>;
}
