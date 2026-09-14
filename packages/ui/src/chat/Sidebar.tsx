/**
 * Single-level sidebar — replaces the old icon `ActivityBar` rail AND the
 * `w-72` session-list aside. Three vertical regions:
 *   • top (fixed):   new-chat, then DSH workspace slot contributions.
 *   • middle (flex): chat history, switchable between a time-ordered stream
 *                    and workspace-directory groups.
 *   • bottom (fixed): the personal menu.
 * Carries `bg-muted/40` so it reads as one chrome surface with the top bar.
 */
import {
  Archive,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder,
  List,
  ListTodo,
  ListTree,
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
   * NON-EMPTY group — sibling to, and after, the built-in "最近任务"
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
  sidebarFooterActions,
  wide = true,
  settingsOpen = false,
  className,
  itemMenuItems,
  groups,
}: SidebarProps) {
  const { t } = useT();
  const workspaceBindings = useWorkspaceBindings(sessions);
  const [selectingSessions, setSelectingSessions] = useState(false);
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
   * top-level section after "最近任务", never inside
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

      {/* History groups share one scroll area and follow their content height. */}
      <ScrollArea className="min-h-0 flex-1 px-2">
        <section className="[--session-group-sticky-top:2rem]">
          <div
            data-testid="sessions-header"
            style={{ backgroundColor: "color-mix(in srgb, hsl(var(--muted)) 30%, hsl(var(--background)))" }}
            className="sticky top-0 z-30 flex h-8 shrink-0 items-center gap-0.5 pb-0 pl-2.5 pr-1.5 pt-1"
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
                <HistoryCollapseButton
                  fullRow
                  collapsed={historyCollapsed}
                  label={t("sidepanel.sessions.title")}
                  onClick={() => setHistoryCollapsed((collapsed) => !collapsed)}
                />
                <div className="absolute right-8 z-10 flex items-center">
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
                </div>
              </>
            )}
            {selectingSessions ? <HistoryCollapseButton
              collapsed={historyCollapsed}
              label={t("sidepanel.sessions.title")}
              onClick={() => setHistoryCollapsed((collapsed) => !collapsed)}
            /> : null}
          </div>
          {!historyCollapsed ? (
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
              itemMenuItems={itemMenuItems}
            />
          ) : null}
        </section>
        {/*
          Plugin-group sections (`amiba.sessions.list.group`) — one
          top-level, always-header'd section per NON-EMPTY group, after the
          built-in "最近任务" section and in plugin registration order.
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
              indentRows={historyLayout === "grouped"}
              itemMenuItems={itemMenuItems}
            />
          </TopSection>
        ))}
      </ScrollArea>

      <div className="mt-1 border-t border-border/30 p-2">
        <ProfileMenu
          wide={wide}
          settingsOpen={settingsOpen}
          settingsTrigger={settingsTrigger}
          onOpenSettings={onOpenSettings}
        />
        {sidebarFooterActions?.({ wide })}
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

function HistoryCollapseButton({
  fullRow = false,
  collapsed,
  label,
  onClick,
}: {
  fullRow?: boolean;
  collapsed: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40",
        fullRow ? "absolute inset-0 w-full justify-between pl-2.5 pr-2.5 text-left" : "h-6 w-6 shrink-0 justify-center",
      )}
    >
      {fullRow ? <span className="min-w-0 flex-1 truncate pr-8 text-[11px] font-medium uppercase tracking-[0.08em]">{label}</span> : null}
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </span>
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
