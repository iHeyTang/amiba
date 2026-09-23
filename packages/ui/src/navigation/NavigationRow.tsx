import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../primitives/cn";

export interface NavigationRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean;
  trailing?: ReactNode;
  /**
   * Replace the icon + label pair with arbitrary row content, keeping the
   * button chrome (hit target, selection treatment, focus surface). The one
   * consumer today is the sidebar's Settings row, whose content is the
   * official `settings.trigger` seat — a slot whose contract is that the
   * whole content, icon included, arrives from the registrant. `icon` and
   * `label` stay required so every call site still declares the row's
   * fallback identity.
   */
  body?: ReactNode;
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
  body,
  className,
  ...props
}: NavigationRowProps) {
  return (
    <button
      data-navigation-row
      data-active={active ? "true" : undefined}
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "app-no-drag group flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm font-normal transition-colors",
        "focus-visible:bg-accent/70 focus-visible:text-foreground focus-visible:outline-none",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {body ?? (
        <>
          <span
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-colors [&_svg]:h-4 [&_svg]:w-4",
              active && "text-foreground/80",
            )}
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </>
      )}
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
