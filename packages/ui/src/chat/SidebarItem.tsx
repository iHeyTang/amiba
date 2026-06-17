/**
 * One row in the single-level sidebar — icon + label as a full-width
 * left-aligned button. Reused for the new-chat / search / nav / settings
 * rows so they share active-state styling and hit-target geometry.
 */
import type { ReactNode } from "react";
import { cn } from "../primitives";

export interface SidebarItemProps {
  /** Stable id — also drives the `sidebar-item-${id}` test hook. */
  id: string;
  icon: ReactNode;
  label: string;
  /** Soft foreground tint when this row is the active view. */
  active?: boolean;
  onClick: () => void;
  /** Tooltip; defaults to `label`. */
  title?: string;
  /** Optional right-aligned element (count badge, action button…). */
  trailing?: ReactNode;
}

export function SidebarItem({
  id,
  icon,
  label,
  active,
  onClick,
  title,
  trailing,
}: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-testid={`sidebar-item-${id}`}
      className={cn(
        "app-no-drag group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {trailing}
    </button>
  );
}
