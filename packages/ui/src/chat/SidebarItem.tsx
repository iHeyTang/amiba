/**
 * One row in the single-level sidebar — icon + label as a full-width
 * left-aligned button. Reused for the new-chat / search / nav / settings
 * rows so they share active-state styling and hit-target geometry.
 */
import type { ReactNode } from "react";
import { NavigationRow } from "../navigation/NavigationRow";

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
    <NavigationRow
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      data-testid={`sidebar-item-${id}`}
      icon={icon}
      label={label}
      active={active}
      trailing={trailing}
    />
  );
}
