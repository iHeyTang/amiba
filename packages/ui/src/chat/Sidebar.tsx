/**
 * Single-level sidebar — replaces the old icon `ActivityBar` rail AND the
 * `w-72` session-list aside. Three vertical regions:
 *   • top (fixed):   new-chat, search (toggles an inline filter), then the
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
  Sparkles,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import type { SessionMeta } from "@amiba/core";
import { useT } from "@amiba/i18n";
import type { MainContribution } from "@amiba/extension-host/renderer";
import { Input, cn } from "../primitives";
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
  query: string;
  onQueryChange: (q: string) => void;
  sessions: SessionMeta[];
  activeSessionId: string;
  sessionsReady: boolean;
  onOpenSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  onRefreshSessions: () => void | Promise<void>;
  onOpenSettings: () => void;
  className?: string;
}

export function Sidebar({
  activeView,
  onSelectView,
  onNewChat,
  extensionItems,
  query,
  onQueryChange,
  sessions,
  activeSessionId,
  sessionsReady,
  onOpenSession,
  onRenameSession,
  onDeleteSession,
  onRefreshSessions,
  onOpenSettings,
  className,
}: SidebarProps) {
  const { t } = useT();
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Built-in non-chat destinations get implicit orders 1–3 so extension items
  // (manifest default order 100) sort after them, while an extension that sets
  // order=0 can still sort first.
  const coreNav: NavRow[] = [
    {
      id: "scheduled",
      icon: <Clock className="h-[18px] w-[18px]" />,
      label: t("sidepanel.sessions.group.scheduled"),
      order: 1,
    },
    {
      id: "skills",
      icon: <Sparkles className="h-[18px] w-[18px]" />,
      label: t("sidepanel.sessions.group.skills"),
      order: 2,
    },
    {
      id: "tools",
      icon: <Wrench className="h-[18px] w-[18px]" />,
      label: t("sidepanel.sessions.group.tools"),
      order: 3,
    },
  ];
  const extNav: NavRow[] = (extensionItems ?? []).map((e) => ({
    id: e.extensionId,
    icon: resolveExtensionIcon(e.icon) ?? <BookOpen className="h-[18px] w-[18px]" />,
    label: e.label,
    order: e.order,
  }));
  const navRows = [...coreNav, ...extNav].sort((a, b) => a.order - b.order);

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function closeSearch() {
    setSearchOpen(false);
    onQueryChange("");
  }

  return (
    <nav
      aria-label={t("sidepanel.sessions.activityBar.aria")}
      className={cn(
        "flex min-h-0 w-60 shrink-0 flex-col gap-0.5 bg-muted/40 px-2 py-2",
        className,
      )}
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
        active={searchOpen}
        onClick={() => (searchOpen ? closeSearch() : openSearch())}
      />
      {searchOpen && (
        <div className="px-1 py-1">
          <div className="relative flex items-center">
            <Input
              ref={inputRef}
              data-testid="sidebar-search-input"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              placeholder={t("chat.searchPlaceholder")}
              className="h-7 w-full pr-7 text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange("")}
                aria-label={t("chat.searchClear")}
                className="absolute right-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}
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
          query={query}
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
