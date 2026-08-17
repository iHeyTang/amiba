import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../primitives/cn";

export interface PaneHeaderBarProps extends ComponentPropsWithoutRef<"header"> {
  heightPx?: number;
  leftInset?: number;
  leading?: ReactNode;
  trailing?: ReactNode;
  bordered?: boolean;
}

/**
 * Single-row fixed head shared by the chat surface and Settings. Geometry
 * (height, OS-chrome left inset, drag-region passthrough via className)
 * lives here so the two surfaces cannot drift apart.
 */
export function PaneHeaderBar({
  heightPx = 40,
  leftInset = 0,
  leading,
  trailing,
  bordered = false,
  className,
  style,
  children,
  ...props
}: PaneHeaderBarProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center bg-background pr-3",
        bordered && "border-b border-border/45",
        className,
      )}
      style={{
        height: heightPx,
        paddingLeft: Math.max(leftInset, 12),
        ...style,
      }}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">{leading}</div>
      {trailing ? (
        <div className="app-no-drag flex shrink-0 items-center gap-1">
          {trailing}
        </div>
      ) : null}
      {children}
    </header>
  );
}
