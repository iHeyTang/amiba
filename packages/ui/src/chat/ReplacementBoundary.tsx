import type { ReactNode } from "react";

/** The slot renderer, not the rendered value, decides whether fallback is needed. */
export function ReplacementBoundary({ render, children }: {
  render?: (fallback: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  return <>{render ? render(children) : children}</>;
}
