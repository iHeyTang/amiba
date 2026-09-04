/**
 * Reusable session history list. By default it groups rows by channel; callers
 * may provide a custom grouping key or hide section headers to render a single
 * time-ordered stream. The main sidebar uses this to switch between a flat
 * timeline and a by-workspace grouping of the same rows.
 *
 * Search and new-chat are NOT rendered here — both live in the top bar
 * now (VSCode command-center style). The host passes the active query
 * down and we filter accordingly.
 */

import {
  Archive,
  CheckSquare,
  Download,
  GitBranch,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { resolveChannel, SOURCE_LOCAL, type SessionMeta } from "@amiba/app-runtime/core";
import { useT, type MessageKey } from "@amiba/i18n";
import { CascadeMenu, Input, type CascadeMenuItem, cn } from "../primitives";
import {
  matchesSessionQuery,
  resolveMenuItems,
  type SessionListMenuItem,
} from "./session-list-extensions";
import { TopSection } from "./TopSection";

const HISTORY_PAGE_SIZE = 20;

export interface SessionsListViewProps {
  sessions: SessionMeta[];
  runningSessionIds?: ReadonlySet<string>;
  failedSessionIds?: ReadonlySet<string>;
  activeId: string;
  ready: boolean;
  query: string;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  /**
   * Archive on the host. One-way — DSH has no unarchive RPC — so the action
   * is offered only on rows that are not archived yet.
   */
  onArchive?: (id: string) => void | Promise<void>;
  onBranch?: (id: string) => void | Promise<void>;
  onExport?: (id: string) => void | Promise<void>;
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (id: string) => void;
  /**
   * Fired once on mount so the host can re-fetch the underlying index —
   * rows authored by external session authors (DSH plugins / CLI) appear
   * without waiting for the next storage-watch broadcast.
   */
  onRefresh?: () => void | Promise<void>;
  /** Shown when the (filtered) list is empty. Defaults to chat copy. */
  emptyLabel?: string;
  /** Shown when ``query`` is non-empty but yields no matches. */
  noMatchesLabel?: string;
  /**
   * Override the per-section label. When omitted, the default
   * ``{channel} chats`` template based on the channel descriptor is
   * used (right for chats). The main sidebar's grouped layout passes a
   * function that resolves a workspace group key into its folder name.
   */
  sectionLabelFor?: (source: string) => string;
  /**
   * Per-section right-edge actions (icon buttons), revealed on hover.
   * Returning `null`/`undefined` hides the slot for that section.
   */
  sectionActionsFor?: (source: string) => ReactNode;
  /** Optional semantic icon for each top-level history section. */
  sectionIconFor?: (source: string) => ReactNode;
  /** Full section title used when a shortened label is displayed. */
  sectionTitleFor?: (source: string) => string | undefined;
  /** Typography override for section labels. */
  sectionLabelClassName?: string;
  /** Override the grouping key. Defaults to the session's channel source. */
  groupKeyFor?: (session: SessionMeta) => string;
  /** Stable section order when `groupKeyFor` is supplied. */
  sectionOrder?: string[];
  /** Hide section chrome for a single, time-ordered flat history. */
  showSectionHeaders?: boolean;
  /** Optional leading icon used to distinguish mixed history row types. */
  rowIconFor?: (session: SessionMeta) => ReactNode;
  /** Align rows beneath a tree-group label rather than with the group icon. */
  indentRows?: boolean;
  /** Disable rename/archive affordances for read-only rows. */
  allowActionsFor?: (session: SessionMeta) => boolean;
  /**
   * `amiba.sessions.item.menu` contributions. Appended to each row's "more"
   * (⋯) menu after the built-in actions (rename/branch/archive/export), with
   * a separator before the first visible plugin item.
   * Visibility is re-evaluated per row via `resolveMenuItems`.
   */
  itemMenuItems?: readonly SessionListMenuItem[];
}

export function SessionsListView({
  sessions,
  runningSessionIds,
  failedSessionIds,
  activeId,
  ready,
  query,
  onOpen,
  onRename,
  onArchive,
  onBranch,
  onExport,
  selecting = false,
  selectedIds,
  onToggleSelected,
  onRefresh,
  emptyLabel,
  noMatchesLabel,
  sectionLabelFor,
  sectionActionsFor,
  sectionIconFor,
  sectionTitleFor,
  sectionLabelClassName,
  groupKeyFor,
  sectionOrder,
  showSectionHeaders = true,
  rowIconFor,
  indentRows = false,
  allowActionsFor,
  itemMenuItems,
}: SessionsListViewProps) {
  const { t } = useT();

  useEffect(() => {
    if (onRefresh) void onRefresh();
    // One-shot mount refresh — re-running on every onRefresh identity
    // change would chatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Sessions split by originating channel. Each channel becomes its own
   * top-level section; date-bucket grouping (Today / Yesterday / …) lives
   * inside each section.
   */
  const channelSections = useMemo(() => {
    const untitledLabel = t("chat.untitled");
    const live = sessions.filter((s) => matchesSessionQuery(s, query, untitledLabel));

    const bySource = new Map<string, SessionMeta[]>();
    for (const s of live) {
      const src = groupKeyFor?.(s) ?? s.source ?? SOURCE_LOCAL;
      const arr = bySource.get(src) ?? [];
      arr.push(s);
      bySource.set(src, arr);
    }
    // Defensive newest-first sort within each bucket. Upstream hooks
    // already return rows in this order, but the date sub-headers used
    // to enforce it explicitly — keep the guarantee now that the flat
    // render order alone determines the user-visible sequence.
    for (const arr of bySource.values()) {
      arr.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    }

    const sections: {
      source: string;
      label: string;
      items: SessionMeta[];
      isLocal: boolean;
    }[] = [];
    const defaultLabelFor = (src: string): string => {
      const descriptor = resolveChannel(src);
      const channelTranslated = t(descriptor.labelKey as MessageKey);
      const channelName =
        channelTranslated === descriptor.labelKey
          ? descriptor.fallbackLabel
          : channelTranslated;
      return t("sidepanel.sessions.group.channelChats", { name: channelName });
    };
    const labelFor = sectionLabelFor ?? defaultLabelFor;
    if (groupKeyFor) {
      const orderedKeys = [
        ...(sectionOrder ?? []).filter((key) => bySource.has(key)),
        ...Array.from(bySource.keys()).filter(
          (key) => !(sectionOrder ?? []).includes(key),
        ),
      ];
      for (const source of orderedKeys) {
        const items = bySource.get(source);
        if (!items?.length) continue;
        sections.push({
          source,
          label: labelFor(source),
          items,
          isLocal: false,
        });
      }
    } else {
      const localItems = bySource.get(SOURCE_LOCAL);
      if (localItems && localItems.length) {
        sections.push({
          source: SOURCE_LOCAL,
          label: labelFor(SOURCE_LOCAL),
          items: localItems,
          isLocal: true,
        });
      }
      const remote = Array.from(bySource.entries())
        .filter(([src]) => src !== SOURCE_LOCAL)
        .sort((a, b) => b[1].length - a[1].length);
      for (const [src, items] of remote) {
        sections.push({
          source: src,
          label: labelFor(src),
          items,
          isLocal: false,
        });
      }
    }
    return sections;
  }, [sessions, query, t, sectionLabelFor, groupKeyFor, sectionOrder]);

  const totalMatching = useMemo(
    () => channelSections.reduce((s, sec) => s + sec.items.length, 0),
    [channelSections],
  );

  // Per-section collapse state. Keyed by SessionDB source so adding a
  // new channel surface doesn't clobber the user's collapse choices for
  // the existing ones.
  const [topCollapsed, setTopCollapsed] = useState<Record<string, boolean>>({});
  const toggleTop = (k: string) =>
    setTopCollapsed((p) => ({ ...p, [k]: !p[k] }));

  if (!ready) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        {t("chat.loadingSessions")}
      </div>
    );
  }

  const emptyText = query
    ? (noMatchesLabel ?? t("chat.noMatches"))
    : (emptyLabel ?? t("chat.noSessions"));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      {totalMatching === 0 ? (
        showSectionHeaders ? (
          <TopSection
            label={t("sidepanel.sessions.group.channelChats", {
              name: (() => {
                const d = resolveChannel(SOURCE_LOCAL);
                const tr = t(d.labelKey as MessageKey);
                return tr === d.labelKey ? d.fallbackLabel : tr;
              })(),
            })}
            collapsed={!!topCollapsed[SOURCE_LOCAL]}
            onToggle={() => toggleTop(SOURCE_LOCAL)}
            variant="rail"
          >
            <p className="px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
              {emptyText}
            </p>
          </TopSection>
        ) : (
          <p className="px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
            {emptyText}
          </p>
        )
      ) : (
        channelSections.map((sec) => {
          const rows = (
            <SessionRowsList
              sessions={sec.items}
              activeId={activeId}
              onOpen={onOpen}
              onRename={onRename}
              onArchive={onArchive}
              onBranch={onBranch}
              onExport={onExport}
              selecting={selecting}
              selectedIds={selectedIds}
              onToggleSelected={onToggleSelected}
              runningSessionIds={runningSessionIds}
              failedSessionIds={failedSessionIds}
              rowIconFor={rowIconFor}
              indentRows={indentRows}
              allowActionsFor={allowActionsFor}
              itemMenuItems={itemMenuItems}
            />
          );
          return showSectionHeaders ? (
            <TopSection
              key={sec.source}
              label={sec.label}
              collapsed={!!topCollapsed[sec.source]}
              onToggle={() => toggleTop(sec.source)}
              variant="rail"
              actions={sectionActionsFor?.(sec.source)}
              icon={sectionIconFor?.(sec.source)}
              title={sectionTitleFor?.(sec.source)}
              labelClassName={sectionLabelClassName}
            >
              {rows}
            </TopSection>
          ) : (
            <div key={sec.source} className="pt-1">
              {rows}
            </div>
          );
        })
      )}
    </div>
  );
}

export interface SessionRowsListProps {
  sessions: SessionMeta[];
  runningSessionIds?: ReadonlySet<string>;
  failedSessionIds?: ReadonlySet<string>;
  activeId: string;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onArchive?: (id: string) => void | Promise<void>;
  onBranch?: (id: string) => void | Promise<void>;
  onExport?: (id: string) => void | Promise<void>;
  selecting?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (id: string) => void;
  rowIconFor?: (session: SessionMeta) => ReactNode;
  indentRows?: boolean;
  allowActionsFor?: (session: SessionMeta) => boolean;
  itemMenuItems?: readonly SessionListMenuItem[];
}

/**
 * One section's session rows, with a local "show more" affordance —
 * extracted so both `SessionsListView`'s own channel sections AND a host's
 * own top-level sections (e.g. `Sidebar`'s plugin-group sections, rendered
 * as siblings of "最近任务" rather than nested inside `SessionsListView`)
 * render rows identically. The show-more limit is local state, one page
 * (`HISTORY_PAGE_SIZE`) at a time — scoped to this component instance, so a
 * caller rendering several instances (one per section) does not need to key
 * a shared limit map itself.
 */
export function SessionRowsList({
  sessions,
  runningSessionIds,
  failedSessionIds,
  activeId,
  onOpen,
  onRename,
  onArchive,
  onBranch,
  onExport,
  selecting = false,
  selectedIds,
  onToggleSelected,
  rowIconFor,
  indentRows = false,
  allowActionsFor,
  itemMenuItems,
}: SessionRowsListProps) {
  const { t } = useT();
  const [visibleLimit, setVisibleLimit] = useState(HISTORY_PAGE_SIZE);
  const activeIndex = sessions.findIndex((s) => s.id === activeId);
  const effectiveLimit =
    activeIndex >= visibleLimit
      ? Math.ceil((activeIndex + 1) / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE
      : visibleLimit;
  const visible = sessions.slice(0, effectiveLimit);
  const hiddenCount = sessions.length - visible.length;

  return (
    <>
      <nav className="flex flex-col gap-0.5">
        {visible.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            running={runningSessionIds?.has(s.id) ?? false}
            failed={failedSessionIds?.has(s.id) ?? false}
            active={s.id === activeId}
            onOpen={() => onOpen(s.id)}
            onRename={(title) => onRename(s.id, title)}
            onArchive={onArchive ? () => onArchive(s.id) : undefined}
            onBranch={onBranch ? () => onBranch(s.id) : undefined}
            onExport={onExport ? () => onExport(s.id) : undefined}
            selecting={selecting}
            selected={selectedIds?.has(s.id) ?? false}
            onToggleSelected={() => onToggleSelected?.(s.id)}
            icon={rowIconFor?.(s)}
            nested={indentRows}
            allowActions={allowActionsFor?.(s) ?? true}
            itemMenuItems={itemMenuItems}
          />
        ))}
      </nav>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() =>
            setVisibleLimit((previous) => previous + HISTORY_PAGE_SIZE)
          }
          className="mx-0.5 flex h-7 items-center rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          {t("sidepanel.sessions.showMore")}
        </button>
      ) : null}
    </>
  );
}

interface SessionRowProps {
  session: SessionMeta;
  running: boolean;
  failed: boolean;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onArchive?: () => void | Promise<void>;
  onBranch?: () => void | Promise<void>;
  onExport?: () => void | Promise<void>;
  selecting: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  icon?: ReactNode;
  nested?: boolean;
  allowActions: boolean;
  /**
   * `amiba.sessions.item.menu` contributions, unfiltered — this row resolves
   * its own visible subset via `resolveMenuItems`.
   */
  itemMenuItems?: readonly SessionListMenuItem[];
}

function SessionRow({
  session,
  running,
  failed,
  active,
  onOpen,
  onRename,
  onArchive,
  onBranch,
  onExport,
  selecting,
  selected,
  onToggleSelected,
  icon,
  nested,
  allowActions,
  itemMenuItems = [],
}: SessionRowProps) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  useEffect(() => {
    if (!editing) setDraft(session.title);
  }, [session.title, editing]);

  function commit() {
    const next = draft.trim();
    if (next && next !== session.title) onRename(next);
    setEditing(false);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(session.title);
      setEditing(false);
    }
  }

  const statusLabel = running
    ? t("sidepanel.sessions.running")
    : failed
      ? t("sidepanel.sessions.failed")
      : session.unread
        ? t("sidepanel.sessions.unread")
        : null;
  const statusGlyph = statusLabel ? (
    <span
      aria-hidden
      className={cn(
        "amiba-session-status-dot block h-1.5 w-1.5 rounded-full",
        running
          ? "amiba-session-status-breathe bg-muted-foreground/80"
          : failed
            ? "bg-[hsl(var(--warning))]"
            : "bg-[hsl(var(--status-session))]",
      )}
    />
  ) : null;
  const menuItems: CascadeMenuItem[] = [
    {
      id: "rename",
      icon: <Pencil />,
      label: t("chat.rename"),
      onSelect: () => setEditing(true),
    },
    ...(onBranch
      ? [
          {
            id: "branch",
            icon: <GitBranch />,
            label: t("sidepanel.sessions.branch"),
            onSelect: () => void onBranch(),
          },
        ]
      : []),
    // Archive is one-way (DSH ships no unarchive), so an already-archived
    // row simply has no archive action.
    ...(onArchive && !session.archived
      ? [
          {
            id: "archive",
            icon: <Archive />,
            label: t("sidepanel.sessions.archive"),
            onSelect: () => void onArchive(),
          },
        ]
      : []),
    ...(onExport
      ? [
          {
            id: "export",
            icon: <Download />,
            label: t("sidepanel.sessions.export"),
            onSelect: () => void onExport(),
          },
        ]
      : []),
  ];
  // `amiba.sessions.item.menu` contributions: appended after the built-in
  // actions above, first visible one carrying the divider. A throwing/
  // rejecting `run` is caught here so it never bubbles into the row.
  resolveMenuItems(session, itemMenuItems).forEach((item, index) => {
    menuItems.push({
      id: item.id,
      label: item.label,
      separatorBefore: index === 0,
      onSelect: () => {
        void Promise.resolve()
          .then(() => item.run(session))
          .catch((error) => {
            console.error(
              `[SessionsListView] session menu item "${item.id}" failed:`,
              error,
            );
          });
      },
    });
  });

  if (editing) {
    return (
      <div
        className={cn(
          "mx-0.5 flex h-8 items-center rounded-md pr-2",
          nested ? "pl-8" : "pl-2",
          active && "bg-secondary",
        )}
      >
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          className="h-7 min-w-0 flex-1 px-1.5 text-sm"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative mx-0.5 flex h-8 items-center rounded-md transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-foreground/80 hover:bg-accent/70 hover:text-foreground",
      )}
    >
      {nested && (selecting || statusLabel) ? (
        <span
          aria-hidden={selecting || undefined}
          aria-label={selecting ? undefined : (statusLabel ?? undefined)}
          title={selecting ? undefined : (statusLabel ?? undefined)}
          className="pointer-events-none absolute left-2 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center"
        >
          {selecting ? <SelectionIndicator selected={selected} /> : statusGlyph}
        </span>
      ) : null}
      <button
        type="button"
        aria-pressed={selecting ? selected : undefined}
        onClick={selecting ? onToggleSelected : onOpen}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 pr-2 text-left focus-visible:outline-none",
          nested ? "pl-8" : "pl-2",
        )}
      >
        {!nested && selecting ? (
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <SelectionIndicator selected={selected} />
          </span>
        ) : !nested && statusLabel ? (
          <span
            aria-label={statusLabel}
            title={statusLabel}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
          >
            {statusGlyph}
          </span>
        ) : icon ? (
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70 [&_svg]:h-3.5 [&_svg]:w-3.5">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[13px] font-normal">
          {session.title?.trim() || t("chat.untitled")}
        </span>
      </button>
      {allowActions && !selecting ? (
        <span
          className={cn(
            "pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 bg-gradient-to-l from-45% via-70% to-transparent pl-8 opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            active
              ? "from-secondary via-secondary/95"
              : "from-accent via-accent/95",
          )}
        >
          <CascadeMenu
            align="start"
            size="menu"
            exclusiveGroup="session-actions"
            ariaLabel={t("workspacePane.moreActions")}
            items={menuItems}
            trigger={
              <button
                type="button"
                onClick={(event) => event.stopPropagation()}
                className="pointer-events-none inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
                title={t("workspacePane.moreActions")}
                aria-label={t("workspacePane.moreActions")}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            }
          />
        </span>
      ) : null}
    </div>
  );
}

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border",
        selected && "border-foreground bg-foreground text-background",
      )}
    >
      {selected ? <CheckSquare className="h-3 w-3" /> : null}
    </span>
  );
}
