import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../primitives/cn";

export interface NavigationRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean;
  trailing?: ReactNode;
}

/**
 * Shared navigation row for the app shell and Settings. Keeping the hit
 * target, icon column and selection treatment here prevents the two sidebars
 * from drifting into separate visual systems again.
 */
export function NavigationRow({
  icon,
  label,
  active = false,
  trailing,
  className,
  ...props
}: NavigationRowProps) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "app-no-drag group flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm font-normal transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-colors [&_svg]:h-4 [&_svg]:w-4",
          active && "text-foreground/80",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** Quiet section caption shared by navigation surfaces. */
export function NavigationGroupLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70",
        className,
      )}
    >
      {children}
    </div>
  );
}
