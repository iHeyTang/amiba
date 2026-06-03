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
 * item declares an `iconKey` resolved by the optional `resolveIcon` prop;
 * when unresolved, BookOpen is used as a neutral fallback.
 */

import { BookOpen, Clock, MessageSquare, Sparkles, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@hermes-x/i18n";
import { cn } from "../primitives";

const ICON_MAP: Record<string, ReactNode> = {
  "book-open": <BookOpen className="h-4 w-4" />,
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

export interface ActivityItem {
  id: string;
  icon: ReactNode;
  label: string;
}

export interface ExtensionActivityItem {
  id: string;
  /** Lucide icon name (resolved via the optional `resolveIcon` prop). */
  icon: string;
  /** Localized label — the extension picked it via its own catalog already. */
  label: string;
  order?: number;
}

export interface ActivityBarProps {
  active: string;
  onSelect: (id: string) => void;
  /** Extra className (desktop passes `app-drag-region` on the wrapper). */
  className?: string;
  /** Extension-contributed items merged with core items and sorted by order. */
  extensionItems?: ExtensionActivityItem[];
  /**
   * Resolves an extension icon name to a ReactNode. When absent or when the
   * name is unrecognised, the component falls back to BookOpen.
   */
  resolveIcon?: (icon: string) => ReactNode | null;
}

export function ActivityBar({
  active,
  onSelect,
  className,
  extensionItems,
  resolveIcon,
}: ActivityBarProps) {
  const { t } = useT();

  const coreItems: ActivityItem[] = [
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
    {
      id: "skills",
      icon: <Sparkles className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.skills"),
    },
    {
      id: "tools",
      icon: <Wrench className="h-4 w-4" />,
      label: t("sidepanel.sessions.group.tools"),
    },
  ];

  const extItems: ActivityItem[] = (extensionItems ?? []).map((e) => ({
    id: e.id,
    icon: resolveIcon?.(e.icon) ?? <BookOpen className="h-4 w-4" />,
    label: e.label,
  }));

  const items = [...coreItems, ...extItems].sort((a, b) => {
    const ao = extensionItems?.find((e) => e.id === a.id)?.order ?? 0;
    const bo = extensionItems?.find((e) => e.id === b.id)?.order ?? 0;
    return ao - bo;
  });
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
