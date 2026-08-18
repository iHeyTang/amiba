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
  flex?: boolean;
  actions?: ReactNode;
}

export function TopSection({
  label, icon, title, labelClassName, collapsed, onToggle, children,
  variant = "drawer", flex = false, actions,
}: TopSectionProps) {
  const rail = variant === "rail";
  const header = (
    <div className={rail
      ? "group/topsection relative mt-2 flex h-7 w-full shrink-0 items-center rounded-md text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
      : "group/topsection relative flex w-full shrink-0 items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40"}>
      <button aria-expanded={!collapsed} className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 rounded-[inherit] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40",
        rail ? "h-full w-full px-2.5" : "w-full px-2 py-1.5", actions && "pr-9",
      )} onClick={onToggle} title={title} type="button">
        {!rail ? <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span> : null}
        {icon ? <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/75 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span> : null}
        <span className={cn("flex-1 truncate", labelClassName)}>{label}</span>
        {rail ? <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span> : null}
      </button>
      {actions ? <span className="absolute right-1 z-10 hidden h-6 items-center gap-0.5 group-hover/topsection:flex">{actions}</span> : null}
    </div>
  );
  if (flex) return <section className={cn("flex min-h-0 flex-col", !rail && "border-b border-border/60", collapsed ? "shrink-0" : "flex-1")}>
    {header}{!collapsed ? <div className="min-h-0 flex-1 overflow-y-auto">{children}</div> : null}
  </section>;
  return <section className={cn(!rail && "border-b border-border/60")}>
    {header}{!collapsed ? <div>{children}</div> : null}
  </section>;
}
