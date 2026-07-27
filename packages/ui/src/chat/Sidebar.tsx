/**
 * Single-level sidebar — replaces the old icon `ActivityBar` rail AND the
 * `w-72` session-list aside. Three vertical regions:
 *   • top (fixed):   new-chat, search (opens the command palette), then the
 *                    built-in + extension nav rows.
 *   • middle (flex): unified chat + scheduled-run history, switchable between
 *                    a time-ordered stream and workspace-directory groups.
 *   • bottom (fixed): the settings row.
 * Carries `bg-muted/40` so it reads as one chrome surface with the top bar.
 */
import {
  BookOpen,
  Clock,
  Folder,
  List,
  ListTree,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Wallet,
  Wrench,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { SessionMeta } from "@amiba/core";
import { useT } from "@amiba/i18n";
import type { MainContribution } from "@amiba/extension-host/renderer";
import { cn } from "../primitives";
import { NavigationGroupLabel } from "../navigation/NavigationRow";
import { SidebarItem } from "./SidebarItem";
import { SessionsListView } from "./SessionsListView";
import { useWorkspaceBindings } from "./internal/useWorkspaceBindings";

/** Extension ids are arbitrary strings; no compile-time union needed. */
export type ActivityViewId = string;
export type HistoryLayout = "timeline" | "grouped";

const HISTORY_ALL_GROUP = "__history_all__";
const HISTORY_UNBOUND_GROUP = "__history_unbound__";
const HISTORY_SCHEDULED_GROUP = "__history_scheduled__";
const HISTORY_WORKSPACE_PREFIX = "__history_workspace__:";

function workspaceGroupKey(path: string): string {
  return `${HISTORY_WORKSPACE_PREFIX}${path}`;
}

function workspacePathFromGroup(group: string): string | null {
  return group.startsWith(HISTORY_WORKSPACE_PREFIX)
    ? group.slice(HISTORY_WORKSPACE_PREFIX.length)
    : null;
}

function workspaceName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

const ICON_MAP: Record<string, ReactNode> = {
  "book-open": <BookOpen className="h-4 w-4" />,
  wallet: <Wallet className="h-4 w-4" />,
  wrench: <Wrench className="h-4 w-4" />,
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
  scheduledSessions: SessionMeta[];
  scheduledReady: boolean;
  onOpenScheduledSession: (id: string) => void;
  onRefreshScheduledSessions: () => void | Promise<void>;
  scheduledLabelFor: (source: string) => string;
  historyLayout: HistoryLayout;
  onHistoryLayoutChange: (layout: HistoryLayout) => void;
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
  scheduledSessions,
  scheduledReady,
  onOpenScheduledSession,
  onRefreshScheduledSessions,
  scheduledLabelFor,
  historyLayout,
  onHistoryLayoutChange,
  onOpenSettings,
  widthPx,
  className,
}: SidebarProps) {
  const { t } = useT();
  const workspaceBindings = useWorkspaceBindings(sessions);

  const scheduledIds = useMemo(
    () => new Set(scheduledSessions.map((session) => session.id)),
    [scheduledSessions],
  );
  const historySessions = useMemo(
    () =>
      [
        ...sessions,
        ...scheduledSessions.map((session) => ({
          ...session,
          title: `${scheduledLabelFor(session.source ?? "")} · ${session.title}`,
        })),
      ].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [sessions, scheduledSessions, scheduledLabelFor],
  );
  const groupedSectionOrder = useMemo(() => {
    if (historyLayout !== "grouped") return [];

    const workspaceRecency = new Map<string, number>();
    let hasUnbound = false;
    for (const session of sessions) {
      const path = workspaceBindings.bySessionId[session.id];
      if (!path) {
        hasUnbound = true;
        continue;
      }
      workspaceRecency.set(
        path,
        Math.max(
          workspaceRecency.get(path) ?? 0,
          session.updatedAt ?? session.createdAt ?? 0,
        ),
      );
    }

    const ordered = Array.from(workspaceRecency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([path]) => workspaceGroupKey(path));
    if (hasUnbound) ordered.push(HISTORY_UNBOUND_GROUP);
    if (scheduledSessions.length > 0) ordered.push(HISTORY_SCHEDULED_GROUP);
    return ordered;
  }, [
    historyLayout,
    sessions,
    scheduledSessions.length,
    workspaceBindings.bySessionId,
  ]);

  // Built-in non-chat destinations get low implicit orders so extension items
  // (manifest default order 100) sort after them, while an extension that sets
  // order=0 can still sort first. Skills / Tokens / Tools live in the
  // Settings window (packages/ui/src/skills and /usage as settings panes),
  // not here.
  const coreNav: NavRow[] = [
    {
      id: "scheduled",
      icon: <Clock className="h-4 w-4" />,
      label: t("options.cron.title"),
      order: 1,
    },
  ];
  const extNav: NavRow[] = (extensionItems ?? []).map((e) => ({
    id: e.extensionId,
    icon: resolveExtensionIcon(e.icon) ?? (
      <BookOpen className="h-[18px] w-[18px]" />
    ),
    label: e.label,
    order: e.order,
  }));
  const navRows = [...coreNav, ...extNav].sort((a, b) => a.order - b.order);

  return (
    <nav
      aria-label={t("sidepanel.sessions.activityBar.aria")}
      className={cn(
        "flex min-h-0 w-60 shrink-0 flex-col bg-muted/30",
        className,
      )}
      style={widthPx !== undefined ? { width: widthPx } : undefined}
    >
      {/* Top (fixed): new-chat + search + nav rows */}
      <div className="flex shrink-0 flex-col gap-0.5 p-2 pb-1">
        <NavigationGroupLabel className="pt-0">
          {t("sidepanel.nav.section.workspace")}
        </NavigationGroupLabel>
        <SidebarItem
          id="new-chat"
          icon={<Plus className="h-4 w-4" />}
          label={t("chat.newChat")}
          onClick={onNewChat}
        />
        <SidebarItem
          id="search"
          icon={<Search className="h-4 w-4" />}
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
      </div>

      {/* Middle (flex): chats and scheduled runs always remain visible. */}
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <div className="flex h-8 shrink-0 items-center px-2.5 pt-1">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
            {t("sidepanel.sessions.title")}
          </span>
          <div
            role="group"
            aria-label={t("sidepanel.sessions.layout.aria")}
            className="flex items-center gap-0.5"
          >
            <HistoryLayoutButton
              active={historyLayout === "timeline"}
              label={t("sidepanel.sessions.layout.timeline")}
              onClick={() => onHistoryLayoutChange("timeline")}
            >
              <List className="h-3.5 w-3.5" />
            </HistoryLayoutButton>
            <HistoryLayoutButton
              active={historyLayout === "grouped"}
              label={t("sidepanel.sessions.layout.grouped")}
              onClick={() => onHistoryLayoutChange("grouped")}
            >
              <ListTree className="h-3.5 w-3.5" />
            </HistoryLayoutButton>
          </div>
        </div>
        <SessionsListView
          sessions={historySessions}
          activeId={activeSessionId}
          ready={
            sessionsReady &&
            (historyLayout !== "grouped" || workspaceBindings.ready)
          }
          query=""
          onOpen={(id) =>
            scheduledIds.has(id)
              ? onOpenScheduledSession(id)
              : onOpenSession(id)
          }
          onRename={onRenameSession}
          onDelete={onDeleteSession}
          onRefresh={() => {
            void onRefreshSessions();
            void onRefreshScheduledSessions();
          }}
          emptyLabel={
            scheduledReady
              ? t("sidepanel.sessions.history.empty")
              : t("sidepanel.sessions.scheduled.loading")
          }
          groupKeyFor={(session) =>
            historyLayout === "timeline"
              ? HISTORY_ALL_GROUP
              : scheduledIds.has(session.id)
                ? HISTORY_SCHEDULED_GROUP
                : workspaceBindings.bySessionId[session.id]
                  ? workspaceGroupKey(workspaceBindings.bySessionId[session.id])
                  : HISTORY_UNBOUND_GROUP
          }
          sectionOrder={groupedSectionOrder}
          sectionLabelFor={(source) =>
            source === HISTORY_SCHEDULED_GROUP
              ? t("sidepanel.sessions.group.scheduled")
              : source === HISTORY_UNBOUND_GROUP
                ? t("sidepanel.sessions.group.unbound")
                : workspaceName(workspacePathFromGroup(source) ?? source)
          }
          sectionIconFor={(source) =>
            source === HISTORY_SCHEDULED_GROUP ? (
              <Clock />
            ) : source === HISTORY_UNBOUND_GROUP ? (
              <MessageSquare />
            ) : (
              <Folder />
            )
          }
          sectionTitleFor={(source) =>
            workspacePathFromGroup(source) ?? undefined
          }
          sectionLabelClassName="normal-case tracking-normal text-[12px] text-foreground/75"
          showSectionHeaders={historyLayout === "grouped"}
          rowIconFor={(session) =>
            historyLayout === "timeline" ? (
              scheduledIds.has(session.id) ? (
                <Clock />
              ) : (
                <MessageSquare />
              )
            ) : undefined
          }
          indentRows={historyLayout === "grouped"}
          allowActionsFor={(session) => !scheduledIds.has(session.id)}
        />
      </div>

      {/* Bottom (fixed): settings */}
      <div className="mt-1 border-t border-border/30 p-2 pt-1.5">
        <SidebarItem
          id="settings"
          icon={<Settings className="h-4 w-4" />}
          label={t("chat.settings")}
          title={t("chat.openOptions")}
          onClick={onOpenSettings}
        />
      </div>
    </nav>
  );
}

function HistoryLayoutButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40",
        active
          ? "bg-secondary text-secondary-foreground"
          : "hover:bg-accent/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
