/**
 * VSCode/Obsidian-style activity bar — a narrow icon-only column on the
 * far left of the chat surface that switches the sidebar between
 * top-level views (Chats vs. Scheduled tasks). Each icon is a vertical
 * "tab" — clicking activates a view; the active item gets a left-edge
 * accent stripe and full-strength foreground colour.
 *
 * Width is fixed (48px) — the same activity-bar width VSCode ships, just
 * enough to fit a 24×24 hit target with breathing room while staying
 * narrow enough that the sidebar to its right still feels primary.
 */

import { MessageSquare, Clock } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@hermes-x/i18n";
import { cn } from "../primitives";

export type ActivityViewId = "chats" | "scheduled";

export interface ActivityItem {
  id: ActivityViewId;
  icon: ReactNode;
  label: string;
}

export interface ActivityBarProps {
  active: ActivityViewId;
  onSelect: (id: ActivityViewId) => void;
  /** Extra className (desktop passes `app-drag-region` on the wrapper). */
  className?: string;
}

export function ActivityBar({ active, onSelect, className }: ActivityBarProps) {
  const { t } = useT();
  const items: ActivityItem[] = [
    {
      id: "chats",
      icon: <MessageSquare className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.chats"),
    },
    {
      id: "scheduled",
      icon: <Clock className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.scheduled"),
    },
  ];
  return (
    <nav
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-1 bg-muted/60 py-2",
        className,
      )}
      aria-label={t("sidepanel.sessions.activityBar.aria")}
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            title={item.label}
            className={cn(
              // Active = a soft foreground tint (~10% of the text
              // colour). Theme-aware contrast against the bar's
              // ``bg-muted/60`` without the loudness of ``bg-primary``,
              // and clearly stronger than ``bg-accent`` which collapses
              // into the bar in many palettes.
              "app-no-drag inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors",
              isActive
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </nav>
  );
}
