/**
 * VSCode/Obsidian-style activity bar — a narrow icon-only column on the
 * far left of the chat surface that switches between top-level views
 * (Chats / Scheduled / Skills / Tools). Each icon is a vertical
 * "tab" — clicking activates a view; the active item gets a soft
 * foreground tint and full-strength foreground colour.
 *
 * Width is fixed (48px) — the same activity-bar width VSCode ships, just
 * enough to fit a 24×24 hit target with breathing room while staying
 * narrow enough that the sidebar to its right still feels primary.
 *
 * Chats and Scheduled drive the inner w-72 session-list sidebar. Skills
 * and Tools are page-level destinations — there's no per-view sidebar
 * list, so FullScreenChatView collapses the inner aside and lets those
 * views fill the main pane.
 *
 * Extensions can contribute additional items via `extensionItems`. Each
 * item declares an `icon` (Lucide name) and a pre-localised `label`
 * resolved by the manifest-driven hooks before reaching this component.
 */

import { BookOpen, Clock, MessageSquare, Sparkles, Wallet, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@hermes-x/i18n";
import { cn } from "../primitives";
import type { MainContribution } from "@hermes-x/extension-host/renderer";

const ICON_MAP: Record<string, ReactNode> = {
  "book-open": <BookOpen className="h-4 w-4" />,
  "wallet": <Wallet className="h-4 w-4" />,
  "wrench": <Wrench className="h-4 w-4" />,
};

export function resolveExtensionIcon(name: string): ReactNode | null {
  return ICON_MAP[name] ?? null;
}

/**
 * Widened to `string` so extension-contributed ids (arbitrary strings)
 * work without a compile-time union update. The old narrow union
 * ("chats" | "scheduled" | "skills" | "tools") is no longer needed.
 */
export type ActivityViewId = string;

interface SortableItem {
  id: string;
  icon: ReactNode;
  label: string;
  order: number;
}

export interface ActivityBarProps {
  active: string;
  onSelect: (id: string) => void;
  /** Extra className (desktop passes `app-drag-region` on the wrapper). */
  className?: string;
  /**
   * Extension-contributed items from useExtensionMains(). Each item's
   * extensionId is used as the activity view id and for onSelect.
   */
  extensionItems?: MainContribution[];
}

export function ActivityBar({
  active,
  onSelect,
  className,
  extensionItems,
}: ActivityBarProps) {
  const { t } = useT();

  // Core items get implicit orders 1–4 so that extension items with
  // order >= 100 (the manifest default) always sort after them, while
  // an extension that explicitly sets order=0 can still sort first.
  const coreItems: SortableItem[] = [
    {
      id: "chats",
      icon: <MessageSquare className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.chats"),
      order: 1,
    },
    {
      id: "scheduled",
      icon: <Clock className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.scheduled"),
      order: 2,
    },
    {
      id: "skills",
      icon: <Sparkles className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.skills"),
      order: 3,
    },
    {
      id: "tools",
      icon: <Wrench className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.tools"),
      order: 4,
    },
  ];

  const extItems: SortableItem[] = (extensionItems ?? []).map((e) => ({
    id: e.extensionId,
    icon: resolveExtensionIcon(e.icon) ?? <BookOpen className="h-4 w-4" />,
    label: e.label,
    order: e.order,
  }));

  const items = [...coreItems, ...extItems].sort((a, b) => a.order - b.order);
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
