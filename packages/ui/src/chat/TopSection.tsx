import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../primitives";

export interface TopSectionProps {
  label: string;
  icon?: ReactNode;
  title?: string;
  labelClassName?: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  variant?: "drawer" | "rail";
  actions?: ReactNode;
  actionReplacesChevron?: boolean;
  actionsAlwaysVisible?: boolean;
  headerTestId?: string;
}

export function TopSection({
  label,
  icon,
  title,
  labelClassName,
  collapsed,
  onToggle,
  children,
  variant = "drawer",
  actions,
  actionReplacesChevron = false,
  actionsAlwaysVisible = false,
  headerTestId,
}: TopSectionProps) {
  const rail = variant === "rail";
  const header = (
    <div
      data-testid={headerTestId}
      data-section-header={rail ? "rail" : "drawer"}
      style={
        rail
          ? {
              top: "var(--session-group-sticky-top, 0px)",
            }
          : undefined
      }
      className={
        rail
          ? "group/topsection sticky z-20 mt-2 flex h-7 w-full shrink-0 items-center text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
          : "group/topsection relative flex w-full shrink-0 items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40"
      }
    >
      <button
        aria-expanded={!collapsed}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded-[inherit] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40",
          rail
            ? "h-full w-full px-4 hover:bg-accent/60"
            : "w-full px-2 py-1.5",
          actions && actionReplacesChevron && "pr-9",
        )}
        onClick={onToggle}
        title={title}
        type="button"
      >
        {!rail ? (
          <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        ) : null}
        {icon ? (
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/75 [&_svg]:h-3.5 [&_svg]:w-3.5">
            {icon}
          </span>
        ) : null}
        <span
          className={cn(
            "flex-1 truncate",
            actions && !actionReplacesChevron && "pr-12",
            labelClassName,
          )}
        >
          {label}
        </span>
        {rail && !(actionReplacesChevron && actions) ? (
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
            {collapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </span>
        ) : null}
      </button>
      {actions ? (
        <span
          className={cn(
            "absolute z-10 h-6 items-center gap-0.5",
            rail && !actionReplacesChevron ? "right-7" : "right-1",
            actionReplacesChevron || actionsAlwaysVisible
              ? "flex"
              : "hidden group-hover/topsection:flex group-focus-within/topsection:flex",
          )}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
  return (
    <section data-sidebar-section={rail ? "rail" : undefined} className={cn(!rail && "border-b border-border/60")}>
      {header}
      {!collapsed ? <div data-section-content>{children}</div> : null}
    </section>
  );
}
