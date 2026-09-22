/**
 * Single-level sidebar — replaces the old icon `ActivityBar` rail AND the
 * `w-72` session-list aside. Three vertical regions:
 *   • top (fixed):   new-chat, then DSH workspace slot contributions.
 *   • middle (flex): default tasks, manually selected workspaces, and plugin groups.
 *   • bottom (fixed): the personal menu.
 * Carries `bg-muted/40` so it reads as one chrome surface with the top bar.
 */
import {
  Archive,
  CheckSquare,
  Folder,
  MessageSquare,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { ProfileMenu } from "../profile/ProfileMenu";
import { useMemo, useState, type ReactNode } from "react";

import type { SessionMeta } from "@amiba/app-runtime/core";
import { useT } from "@amiba/i18n";
import { CascadeMenu, type CascadeMenuItem, cn, ScrollArea } from "../primitives";
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

const HISTORY_ALL_GROUP = "__history_all__";
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
  onNewWorkspaceChat?: (path: string) => void;
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
  onOpenSettings: (tab?: string) => void;
  /**
   * Host dispatch of the official `settings.trigger` seat, displayed as
   * the icon and label of the profile menu settings item (`wide: true`).
   */
  settingsTrigger?: (owner: { wide: boolean }) => ReactNode;
  sidebarFooterActions?: (owner: { wide: boolean }) => ReactNode;
  /** Sidebar column state, controlling visibility of the profile nickname. */
  wide?: boolean;
  /** Whether the settings dialog this row opens is currently open. */
  settingsOpen?: boolean;
  className?: string;
  /**
   * `amiba.sessions.item.menu` contributions — forwarded verbatim to
   * `SessionsListView`. See `session-list-extensions.ts`.
   */
  itemMenuItems?: readonly SessionListMenuItem[];
  /**
   * `amiba.sessions.list.group` contributions, in registration order. The
   * sidebar itself partitions `sessions` with these (see
   * `partitionSessionGroups`) and renders one top-level section per
   * NON-EMPTY group — sibling to, and after, the built-in "工作空间"
   * section —
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
  onNewWorkspaceChat,
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
  onOpenSettings,
  settingsTrigger,
  sidebarFooterActions,
  wide = true,
  settingsOpen = false,
  className,
  itemMenuItems,
  groups,
}: SidebarProps) {
  const { t } = useT();
  const workspaceBindings = useWorkspaceBindings();
  const [selectingSessions, setSelectingSessions] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
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
    const workspaceRecency = new Map<string, number>();
    for (const session of historySessions) {
      const path = workspaceBindings.bySessionId[session.id];
      if (!path) continue;
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
    return ordered;
  }, [historySessions, workspaceBindings.bySessionId]);

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
   * top-level section after "工作空间", never inside
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
  const taskSessions = groupPartition.rest.filter(session => !workspaceBindings.bySessionId[session.id]);
  const workspaceSessions = groupPartition.rest.filter(session => !!workspaceBindings.bySessionId[session.id]);
  // Collapse state for the plugin-group sections, keyed by group id —
  // separate from `SessionsListView`'s own per-channel collapse state,
  // since these sections now render outside it entirely.
  const [groupCollapsed, setGroupCollapsed] = useState<
    Record<string, boolean>
  >({});
  const toggleGroupCollapsed = (id: string) =>
    setGroupCollapsed((previous) => ({ ...previous, [id]: !previous[id] }));
  const historyRowIconFor = () => <MessageSquare />;

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

      {/* History groups share one scroll area and follow their content height. */}
      <ScrollArea className="min-h-0 flex-1 px-2">
        <TopSection
          headerTestId="sessions-header"
          label={selectingSessions
            ? t("sidepanel.sessions.selected", { count: selectedSessionIds.size })
            : t("sidepanel.sessions.title")}
          collapsed={historyCollapsed}
          onToggle={() => setHistoryCollapsed(value => !value)}
          variant="rail"
          actionsAlwaysVisible
          actions={selectingSessions ? <>
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
          </> : onArchiveSessions ? (
            <HistoryMoreMenu onStartSelection={() => {
              setSelectedSessionIds(new Set());
              setSelectingSessions(true);
            }} />
          ) : undefined}
        >
          <div className="[--session-group-sticky-top:1.75rem]">
            <SessionsListView
              sessions={workspaceSessions}
              runningSessionIds={runningSessionIds}
              failedSessionIds={failedSessionIds}
              activeId={activeSessionId}
              ready={sessionsReady && workspaceBindings.ready}
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
              groupKeyFor={(session) => workspaceGroupKey(workspaceBindings.bySessionId[session.id])}
              sectionOrder={groupedSectionOrder}
              sectionLabelFor={(source) => workspaceName(workspacePathFromGroup(source) ?? source)}
              sectionIconFor={() => <Folder />}
              sectionTitleFor={(source) =>
                workspacePathFromGroup(source) ?? undefined
              }
              sectionActionsFor={(source) => {
                const path = workspacePathFromGroup(source);
                return path && onNewWorkspaceChat ? (
                  <SessionBulkButton
                    label={t("sidepanel.sessions.newInWorkspace", { name: workspaceName(path) })}
                    icon={<Plus />}
                    onClick={() => onNewWorkspaceChat(path)}
                  />
                ) : null;
              }}
              sectionActionReplacesChevron
              sectionLabelClassName="normal-case tracking-normal text-[12px] text-foreground/75"
              showSectionHeaders={workspaceSessions.length > 0}
              indentRows
              itemMenuItems={itemMenuItems}
            />
          </div>
        </TopSection>
        {/*
          Plugin-group sections (`amiba.sessions.list.group`) — one
          top-level, always-header'd section per NON-EMPTY group, after the
          built-in "工作空间" section and in plugin registration order.
          They use the same rail header chrome as other collapsible sections.
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
              indentRows
              itemMenuItems={itemMenuItems}
            />
          </TopSection>
        ))}
        <TopSection
          label={t("sidepanel.sessions.tasks")}
          collapsed={tasksCollapsed}
          onToggle={() => setTasksCollapsed(value => !value)}
          variant="rail"
        >
          <SessionsListView
            sessions={taskSessions}
            runningSessionIds={runningSessionIds}
            failedSessionIds={failedSessionIds}
            activeId={activeSessionId}
            ready={sessionsReady && workspaceBindings.ready}
            query={historyQuery}
            onOpen={onOpenSession}
            onRename={onRenameSession}
            onArchive={onArchiveSession}
            onBranch={onBranchSession}
            onExport={onExportSession}
            selecting={selectingSessions}
            selectedIds={selectedSessionIds}
            onToggleSelected={toggleSelectedSession}
            showSectionHeaders={false}
            groupKeyFor={() => HISTORY_ALL_GROUP}
            rowIconFor={() => <MessageSquare />}
            itemMenuItems={itemMenuItems}
            emptyLabel={t("sidepanel.sessions.tasks.empty")}
          />
        </TopSection>
      </ScrollArea>

      <div className="px-2">
        {sidebarFooterActions?.({ wide })}
      </div>
      <div className="mt-1 border-t border-border/30 p-2">
        <ProfileMenu
          wide={wide}
          settingsOpen={settingsOpen}
          settingsTrigger={settingsTrigger}
          onOpenSettings={onOpenSettings}
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
  onStartSelection,
}: {
  onStartSelection?: () => void;
}) {
  const { t } = useT();
  if (!onStartSelection) return null;
  const menuItems: CascadeMenuItem[] = [{
    id: "select",
    label: t("sidepanel.sessions.select"),
    icon: <CheckSquare />,
    onSelect: onStartSelection,
  }];
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
