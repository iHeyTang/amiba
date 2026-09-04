/**
 * Single-level sidebar — replaces the old icon `ActivityBar` rail AND the
 * `w-72` session-list aside. Three vertical regions:
 *   • top (fixed):   new-chat, then DSH workspace slot contributions.
 *   • middle (flex): chat history, switchable between a time-ordered stream
 *                    and workspace-directory groups.
 *   • bottom (fixed): the settings row.
 * Carries `bg-muted/40` so it reads as one chrome surface with the top bar.
 */
import {
  Archive,
  CheckSquare,
  Folder,
  List,
  ListTodo,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { SessionMeta } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { CascadeMenu, type CascadeMenuItem, cn } from "../primitives";
import { SettingsTriggerContent } from "../settings/SettingsTriggerContent";
import { SidebarItem } from "./SidebarItem";
import { SessionRowsList, SessionsListView } from "./SessionsListView";
import {
  matchesSessionQuery,
  partitionSessionGroups,
  type SessionListGroup,
  type SessionListMenuItem,
} from "./session-list-extensions";
import { TopSection } from "./TopSection";
import { useWorkspaceBindings } from "./internal/useWorkspaceBindings";

/** Workspace plugin ids are intentionally open-ended. */
export type ActivityViewId = string;
export type HistoryLayout = "timeline" | "grouped";

const HISTORY_ALL_GROUP = "__history_all__";
const HISTORY_UNBOUND_GROUP = "__history_unbound__";
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

export interface SidebarProps {
  navigationBefore?: ReactNode;
  workspaceNavigation?: ReactNode;
  navigationAfter?: ReactNode;
  onNewChat: () => void;
  sessions: SessionMeta[];
  runningSessionIds?: ReadonlySet<string>;
  failedSessionIds?: ReadonlySet<string>;
  activeSessionId: string;
  sessionsReady: boolean;
  onOpenSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  /**
   * Archive on the host — the ONLY "take this off my list" action Amiba
   * has. It is one-way (DSH ships no unarchive) and non-destructive: the
   * session itself is untouched, it simply leaves every list surface.
   */
  onArchiveSession?: (id: string) => void | Promise<void>;
  onBranchSession?: (id: string) => void | Promise<void>;
  onExportSession?: (id: string) => void | Promise<void>;
  /** Batch form of `onArchiveSession`, for the list's selection mode. */
  onArchiveSessions?: (ids: string[]) => void | Promise<void>;
  onRefreshSessions: () => void | Promise<void>;
  historyLayout: HistoryLayout;
  onHistoryLayoutChange: (layout: HistoryLayout) => void;
  onOpenSettings: () => void;
  /**
   * Content of the settings row — the host's dispatch of the official
   * `settings.trigger` seat, whose owner share is exactly `{ wide }`: the
   * sidebar column state, false while the rail is collapsed. Amiba's own
   * icon + label render when the host supplies no renderer (Quick-Ask, the
   * browser extension, any surface outside a DSH plugin runtime).
   */
  settingsTrigger?: (owner: { wide: boolean }) => ReactNode;
  /** Sidebar column state, forwarded to the trigger seat as `wide`. */
  wide?: boolean;
  /** Whether the settings dialog this row opens is currently open. */
  settingsOpen?: boolean;
  className?: string;
  /**
   * Declarative per-row badges — forwarded verbatim to `SessionsListView`.
   * See `session-list-extensions.ts` for the contract.
   */
  itemBadges?: (session: SessionMeta) => readonly string[];
  /**
   * `amiba.sessions.item.menu` contributions — forwarded verbatim to
   * `SessionsListView`. See `session-list-extensions.ts`.
   */
  itemMenuItems?: readonly SessionListMenuItem[];
  /**
   * `amiba.sessions.list.group` contributions, in registration order. The
   * sidebar itself partitions `sessions` with these (see
   * `partitionSessionGroups`) and renders one top-level section per
   * NON-EMPTY group — sibling to, and ahead of, the "最近任务" section —
   * rather than nesting them inside `SessionsListView`'s own channel
   * sections. `SessionsListView` never sees a claimed session twice: it
   * only renders whatever `partitionSessionGroups` leaves in `rest`.
   */
  groups?: readonly SessionListGroup[];
}

export function Sidebar({
  navigationBefore,
  workspaceNavigation,
  navigationAfter,
  onNewChat,
  sessions,
  runningSessionIds,
  failedSessionIds,
  activeSessionId,
  sessionsReady,
  onOpenSession,
  onRenameSession,
  onArchiveSession,
  onBranchSession,
  onExportSession,
  onArchiveSessions,
  onRefreshSessions,
  historyLayout,
  onHistoryLayoutChange,
  onOpenSettings,
  settingsTrigger,
  wide = true,
  settingsOpen = false,
  className,
  itemBadges,
  itemMenuItems,
  groups,
}: SidebarProps) {
  const { t } = useT();
  const workspaceBindings = useWorkspaceBindings(sessions);
  const [selectingSessions, setSelectingSessions] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Archived sessions get no UI entry (DSH ships no unarchive, matching its
  // own client's behavior of hiding archived rows from every grouping
  // surface) — dropped here so a caller that forwards an unfiltered session
  // list still can't surface one.
  const historySessions = useMemo(
    () =>
      sessions
        .filter((session) => !session.archived)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [sessions],
  );
  const selectedSessions = useMemo(
    () =>
      historySessions.filter((session) => selectedSessionIds.has(session.id)),
    [historySessions, selectedSessionIds],
  );
  const leaveSessionSelection = () => {
    setSelectingSessions(false);
    setSelectedSessionIds(new Set());
  };
  const toggleSelectedSession = (id: string) => {
    setSelectedSessionIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const runBulkArchive = async () => {
    if (!onArchiveSessions || selectedSessionIds.size === 0) return;
    await onArchiveSessions(Array.from(selectedSessionIds));
    leaveSessionSelection();
  };
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
    return ordered;
  }, [historyLayout, sessions, workspaceBindings.bySessionId]);

  // `SessionsListView` has no search box of its own (below, it always gets
  // `query=""` too — search lives in the top bar / command palette); kept as
  // a local rather than a literal so the SAME `matchesSessionQuery` call
  // shape applies here as it does inside `SessionsListView`'s own filtering,
  // and so a future search source only needs to flow into this one spot.
  const historyQuery = "";
  const untitledLabel = t("chat.untitled");
  /**
   * `amiba.sessions.list.group` contributions applied once, here — never
   * inside `SessionsListView`. A claimed session renders under its own
   * top-level section (below, ahead of "最近任务"), never inside
   * `SessionsListView`'s channel/workspace sections too. `historySessions`
   * already excludes archived rows, so there is nothing archived left to
   * fold back into `rest`.
   */
  const groupPartition = useMemo(() => {
    const claimable = historySessions.filter((session) =>
      matchesSessionQuery(session, historyQuery, untitledLabel),
    );
    return partitionSessionGroups(claimable, groups ?? []);
  }, [historySessions, groups, historyQuery, untitledLabel]);
  const restSessions = groupPartition.rest;
  // Collapse state for the plugin-group sections, keyed by group id —
  // separate from `SessionsListView`'s own per-channel collapse state,
  // since these sections now render outside it entirely.
  const [groupCollapsed, setGroupCollapsed] = useState<
    Record<string, boolean>
  >({});
  const toggleGroupCollapsed = (id: string) =>
    setGroupCollapsed((previous) => ({ ...previous, [id]: !previous[id] }));
  const historyRowIconFor = () =>
    historyLayout === "timeline" ? <MessageSquare /> : undefined;

  return (
    <nav
      aria-label={t("sidepanel.sessions.activityBar.aria")}
      className={cn("flex min-h-0 w-full flex-col bg-transparent", className)}
    >
      {/* Top (fixed): new-chat + nav rows. Search lives in the pane header. */}
      <div className="flex shrink-0 flex-col gap-0.5 p-2 pb-1">
        {navigationBefore}
        <SidebarItem
          id="new-chat"
          icon={<Plus className="h-4 w-4" />}
          label={t("chat.newChat")}
          onClick={onNewChat}
        />
        {workspaceNavigation}
        {navigationAfter}
      </div>

      {/* Middle (flex): chat history always remains visible. */}
      <div className="flex min-h-0 flex-1 flex-col px-2">
        {/*
          Plugin-group sections (`amiba.sessions.list.group`) — one
          top-level, always-header'd section per NON-EMPTY group, sibling to
          (and ahead of) "最近任务" below, never nested inside it. Same
          header chrome as a channel section (`TopSection` "rail" variant:
          uppercase 11px label + trailing chevron), collapse state local to
          this component and keyed by group id.
        */}
        {groupPartition.groups.map(({ group, items }) => (
          <TopSection
            key={group.id}
            label={group.label}
            collapsed={!!groupCollapsed[group.id]}
            onToggle={() => toggleGroupCollapsed(group.id)}
            variant="rail"
          >
            <SessionRowsList
              sessions={items}
              runningSessionIds={runningSessionIds}
              failedSessionIds={failedSessionIds}
              activeId={activeSessionId}
              onOpen={onOpenSession}
              onRename={onRenameSession}
              onArchive={onArchiveSession}
              onBranch={onBranchSession}
              onExport={onExportSession}
              selecting={selectingSessions}
              selectedIds={selectedSessionIds}
              onToggleSelected={toggleSelectedSession}
              rowIconFor={historyRowIconFor}
              indentRows={historyLayout === "grouped"}
              itemBadges={itemBadges}
              itemMenuItems={itemMenuItems}
            />
          </TopSection>
        ))}
        <div
          data-testid="sessions-header"
          className="flex h-8 shrink-0 items-center gap-0.5 pb-0 pl-2.5 pr-1.5 pt-1"
        >
          {selectingSessions ? (
            <>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">
                {t("sidepanel.sessions.selected", {
                  count: selectedSessionIds.size,
                })}
              </span>
              <SessionBulkButton
                label={t("sidepanel.sessions.archive")}
                icon={<Archive />}
                disabled={!selectedSessionIds.size}
                onClick={() => void runBulkArchive()}
              />
              <SessionBulkButton
                label={t("common.cancel")}
                icon={<X />}
                onClick={leaveSessionSelection}
              />
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                {t("sidepanel.sessions.title")}
              </span>
              <HistoryMoreMenu
                layout={historyLayout}
                onLayoutChange={onHistoryLayoutChange}
                onStartSelection={
                  onArchiveSessions
                    ? () => {
                        setSelectedSessionIds(new Set());
                        setSelectingSessions(true);
                      }
                    : undefined
                }
              />
            </>
          )}
        </div>
        <SessionsListView
          sessions={restSessions}
          runningSessionIds={runningSessionIds}
          failedSessionIds={failedSessionIds}
          activeId={activeSessionId}
          ready={
            sessionsReady &&
            (historyLayout !== "grouped" || workspaceBindings.ready)
          }
          query={historyQuery}
          onOpen={onOpenSession}
          onRename={onRenameSession}
          onArchive={onArchiveSession}
          onBranch={onBranchSession}
          onExport={onExportSession}
          selecting={selectingSessions}
          selectedIds={selectedSessionIds}
          onToggleSelected={toggleSelectedSession}
          onRefresh={() => void onRefreshSessions()}
          emptyLabel={t("sidepanel.sessions.history.empty")}
          groupKeyFor={(session) =>
            historyLayout === "timeline"
              ? HISTORY_ALL_GROUP
              : workspaceBindings.bySessionId[session.id]
                ? workspaceGroupKey(workspaceBindings.bySessionId[session.id])
                : HISTORY_UNBOUND_GROUP
          }
          sectionOrder={groupedSectionOrder}
          sectionLabelFor={(source) =>
            source === HISTORY_UNBOUND_GROUP
              ? t("sidepanel.sessions.group.unbound")
              : workspaceName(workspacePathFromGroup(source) ?? source)
          }
          sectionIconFor={(source) =>
            source === HISTORY_UNBOUND_GROUP ? <ListTodo /> : <Folder />
          }
          sectionTitleFor={(source) =>
            workspacePathFromGroup(source) ?? undefined
          }
          sectionLabelClassName="normal-case tracking-normal text-[12px] text-foreground/75"
          showSectionHeaders={historyLayout === "grouped"}
          rowIconFor={historyRowIconFor}
          indentRows={historyLayout === "grouped"}
          itemBadges={itemBadges}
          itemMenuItems={itemMenuItems}
        />
      </div>

      {/*
        Bottom (fixed): the settings row. It is the official
        `settings.trigger` seat's render site AND the dialog's trigger
        button — `aria-haspopup="dialog"` plus a live `aria-expanded`, the
        same pair the official shell puts on its own trigger.
      */}
      <div className="mt-1 border-t border-border/30 p-2 pt-1.5">
        <SidebarItem
          aria-expanded={settingsOpen}
          aria-haspopup="dialog"
          id="settings"
          icon={<Settings className="h-4 w-4" />}
          label={t("chat.settings")}
          title={t("chat.openOptions")}
          onClick={onOpenSettings}
          body={
            settingsTrigger ? (
              settingsTrigger({ wide })
            ) : (
              <SettingsTriggerContent wide={wide} />
            )
          }
        />
      </div>
    </nav>
  );
}

function SessionBulkButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5"
    >
      {icon}
    </button>
  );
}

function HistoryMoreMenu({
  layout,
  onLayoutChange,
  onStartSelection,
}: {
  layout: HistoryLayout;
  onLayoutChange: (layout: HistoryLayout) => void;
  onStartSelection?: () => void;
}) {
  const { t } = useT();
  const menuItems: CascadeMenuItem[] = [
    ...(onStartSelection
      ? [
          {
            id: "select",
            label: t("sidepanel.sessions.select"),
            icon: <CheckSquare />,
            onSelect: onStartSelection,
          },
        ]
      : []),
    {
      id: "layout",
      label: t("sidepanel.sessions.layout.menu"),
      icon: layout === "timeline" ? <List /> : <ListTree />,
      separatorBefore: Boolean(onStartSelection),
      children: [
        {
          id: "timeline",
          label: t("sidepanel.sessions.layout.timeline"),
          icon: <List />,
          checked: layout === "timeline",
          onSelect: () => onLayoutChange("timeline"),
        },
        {
          id: "grouped",
          label: t("sidepanel.sessions.layout.grouped"),
          icon: <ListTree />,
          checked: layout === "grouped",
          onSelect: () => onLayoutChange("grouped"),
        },
      ],
    },
  ];

  return (
    <CascadeMenu
      align="start"
      ariaLabel={t("sidepanel.sessions.more")}
      items={menuItems}
      maxDepth={5}
      trigger={
        <button
          type="button"
          aria-label={t("sidepanel.sessions.more")}
          title={t("sidepanel.sessions.more")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      }
    />
  );
}
