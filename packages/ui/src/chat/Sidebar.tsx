/**
 * Single-level sidebar — replaces the old icon `ActivityBar` rail AND the
 * `w-72` session-list aside. Three vertical regions:
 *   • top (fixed):   new-chat, search (opens the command palette), then the
 *                    built-in + extension nav rows.
 *   • middle (flex): the conversation-history list (channel-grouped, collapsible).
 *   • bottom (fixed): the settings row.
 * Carries `bg-muted/40` so it reads as one chrome surface with the top bar.
 */
import {
  BookOpen,
  Clock,
  Plus,
  Search,
  Settings,
  Wallet,
  Wrench,
} from "lucide-react";
import { type ReactNode } from "react";

import type { SessionMeta } from "@amiba/core";
import { useT } from "@amiba/i18n";
import type { MainContribution } from "@amiba/extension-host/renderer";
import { cn } from "../primitives";
import { SidebarItem } from "./SidebarItem";
import { SessionsListView } from "./SessionsListView";

/** Extension ids are arbitrary strings; no compile-time union needed. */
export type ActivityViewId = string;

const ICON_MAP: Record<string, ReactNode> = {
  "book-open": <BookOpen className="h-[18px] w-[18px]" />,
  "wallet": <Wallet className="h-[18px] w-[18px]" />,
  "wrench": <Wrench className="h-[18px] w-[18px]" />,
};

export function resolveExtensionIcon(name: string): ReactNode | null {
  return ICON_MAP[name] ?? null;
}

interface NavRow {
  id: string;
  icon: ReactNode;
  label: string;
  order: number;
}

export interface SidebarProps {
  activeView: string;
  onSelectView: (id: string) => void;
  onNewChat: () => void;
  extensionItems?: MainContribution[];
  onOpenCommandPalette: () => void;
  sessions: SessionMeta[];
  activeSessionId: string;
  sessionsReady: boolean;
  onOpenSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onRefreshSessions: () => void | Promise<void>;
  onOpenSettings: () => void;
  /**
   * Explicit column width in px (user-resizable via the drag handle in
   * `FullScreenChatView`). Overrides the `w-60` fallback when provided.
   */
  widthPx?: number;
  className?: string;
}

export function Sidebar({
  activeView,
  onSelectView,
  onNewChat,
  extensionItems,
  onOpenCommandPalette,
  sessions,
  activeSessionId,
  sessionsReady,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onRefreshSessions,
  onOpenSettings,
  widthPx,
  className,
}: SidebarProps) {
  const { t } = useT();

  // Built-in non-chat destinations get low implicit orders so extension items
  // (manifest default order 100) sort after them, while an extension that sets
  // order=0 can still sort first. Skills / Tokens / Tools live in the
  // Settings window (packages/ui/src/skills and /usage as settings panes),
  // not here.
  const coreNav: NavRow[] = [
    {
      id: "scheduled",
      icon: <Clock className="h-[18px] w-[18px]" />,
      label: t("sidepanel.sessions.group.scheduled"),
      order: 1,
    },
  ];
  const extNav: NavRow[] = (extensionItems ?? []).map((e) => ({
    id: e.extensionId,
    icon: resolveExtensionIcon(e.icon) ?? <BookOpen className="h-[18px] w-[18px]" />,
    label: e.label,
    order: e.order,
  }));
  const navRows = [...coreNav, ...extNav].sort((a, b) => a.order - b.order);

  return (
    <nav
      aria-label={t("sidepanel.sessions.activityBar.aria")}
      className={cn(
        "flex min-h-0 w-60 shrink-0 flex-col gap-0.5 bg-muted/40 px-2 py-2",
        className,
      )}
      style={widthPx !== undefined ? { width: widthPx } : undefined}
    >
      {/* Top (fixed): new-chat + search + nav rows */}
      <SidebarItem
        id="new-chat"
        icon={<Plus className="h-[18px] w-[18px]" />}
        label={t("chat.newChat")}
        onClick={onNewChat}
      />
      <SidebarItem
        id="search"
        icon={<Search className="h-[18px] w-[18px]" />}
        label={t("chat.search")}
        onClick={onOpenCommandPalette}
      />
      {navRows.map((row) => (
        <SidebarItem
          key={row.id}
          id={row.id}
          icon={row.icon}
          label={row.label}
          active={row.id === activeView}
          onClick={() => onSelectView(row.id)}
        />
      ))}

      {/* Middle (flex): conversation history */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        <SessionsListView
          sessions={sessions}
          activeId={activeSessionId}
          ready={sessionsReady}
          query=""
          onOpen={onOpenSession}
          onRename={onRenameSession}
          onDelete={onDeleteSession}
          onRefresh={onRefreshSessions}
        />
      </div>

      {/* Bottom (fixed): settings */}
      <div className="mt-1 border-t border-border/40 pt-1">
        <SidebarItem
          id="settings"
          icon={<Settings className="h-[18px] w-[18px]" />}
          label={t("chat.settings")}
          title={t("chat.openOptions")}
          onClick={onOpenSettings}
        />
      </div>
    </nav>
  );
}
