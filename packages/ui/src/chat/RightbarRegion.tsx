import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
export interface RightbarGeometry { width: number; viewportWidth: number; canShow: boolean }
/** Normal DSH layout requires 300px for the panel and 400px for conversation. */
export function rightbarGeometry(viewportWidth: number, leftWidth: number, preferred: number): RightbarGeometry {
  const canShow = viewportWidth >= 700;
  const room = viewportWidth - leftWidth >= 700 ? viewportWidth - leftWidth : viewportWidth;
  return { viewportWidth, canShow, width: canShow ? Math.min(Math.max(300, preferred), room - 400) : 0 };
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
