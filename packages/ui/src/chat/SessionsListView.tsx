/**
 * Reusable session history list. By default it groups rows by channel; callers
 * may provide a custom grouping key or hide section headers to render a single
 * time-ordered stream. This lets the main sidebar mix chats and scheduled runs
 * without maintaining two competing list implementations.
 *
 * Search and new-chat are NOT rendered here — both live in the top bar
 * now (VSCode command-center style). The host passes the active query
 * down and we filter accordingly.
 */

import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  Download,
  GitBranch,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { resolveChannel, SOURCE_LOCAL, type SessionMeta } from "@amiba/core";
import { useT, type MessageKey } from "@amiba/i18n";
import {
  Input,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "../primitives";
import { TopSection } from "./SessionGroups";

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
  onDelete: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void | Promise<void>;
  onArchive?: (id: string, archived: boolean) => void | Promise<void>;
  onBranch?: (id: string) => void | Promise<void>;
  onExport?: (id: string) => void | Promise<void>;
  onImport?: (file: File) => void | Promise<void>;
  onBulkAction?: (
    ids: string[],
    action: "archive" | "unarchive" | "pin" | "unpin" | "delete",
  ) => void | Promise<void>;
  /**
   * Fired once on mount so the host can re-fetch the underlying index —
   * multi-channel rows authored elsewhere (gateway / CLI / cron) appear
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
   * used (right for chats). The Scheduled view passes a function that
   * resolves the cron job id into a human-readable job name.
   */
  sectionLabelFor?: (source: string) => string;
  /**
   * Per-section right-edge actions (icon buttons), revealed on hover.
   * Returning `null`/`undefined` hides the slot for that section. Used
   * by the Scheduled view to surface a "trigger this job now" button
   * per cron-job group.
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
  /** Disable rename/delete affordances for read-only rows such as cron runs. */
  allowActionsFor?: (session: SessionMeta) => boolean;
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
  onDelete,
  onPin,
  onArchive,
  onBranch,
  onExport,
  onImport,
  onBulkAction,
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
}: SessionsListViewProps) {
  const { t } = useT();
  const [showArchived, setShowArchived] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleSelected = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const leaveSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const runBulk = useCallback(
    async (action: "archive" | "unarchive" | "pin" | "unpin" | "delete") => {
      if (!onBulkAction || selected.size === 0) return;
      await onBulkAction(Array.from(selected), action);
      leaveSelection();
    },
    [leaveSelection, onBulkAction, selected],
  );

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
    const q = query.trim().toLowerCase();
    const live = sessions.filter((s) => Boolean(s.archived) === showArchived);
    const matching = q
      ? live.filter((s) =>
          (s.title || t("chat.untitled")).toLowerCase().includes(q),
        )
      : live;

    const bySource = new Map<string, SessionMeta[]>();
    for (const s of matching) {
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
      arr.sort(
        (a, b) =>
          Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
          (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
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
  }, [sessions, query, t, sectionLabelFor, groupKeyFor, sectionOrder, showArchived]);

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
  const [visibleLimits, setVisibleLimits] = useState<Record<string, number>>(
    {},
  );
  const showMore = (source: string) =>
    setVisibleLimits((previous) => ({
      ...previous,
      [source]: (previous[source] ?? HISTORY_PAGE_SIZE) + HISTORY_PAGE_SIZE,
    }));

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
      {(sessions.some((session) => session.archived) || onBulkAction || onImport) ? (
        <div className="sticky top-0 z-10 flex min-h-8 items-center gap-1 bg-background/95 px-1 py-1 backdrop-blur">
          {selecting ? (
            <>
              <span className="min-w-0 flex-1 truncate px-1 text-[10px] text-muted-foreground">
                {t("sidepanel.sessions.selected", { count: selected.size })}
              </span>
              <BulkButton label={t("sidepanel.sessions.pin")} icon={<Pin />} disabled={!selected.size} onClick={() => void runBulk("pin")} />
              <BulkButton label={showArchived ? t("sidepanel.sessions.unarchive") : t("sidepanel.sessions.archive")} icon={showArchived ? <ArchiveRestore /> : <Archive />} disabled={!selected.size} onClick={() => void runBulk(showArchived ? "unarchive" : "archive")} />
              <BulkButton label={t("chat.delete")} icon={<Trash2 />} destructive disabled={!selected.size} onClick={() => {
                if (confirm(t("sidepanel.sessions.bulkDeleteConfirm", { count: selected.size }))) void runBulk("delete");
              }} />
              <BulkButton label={t("common.cancel")} icon={<X />} onClick={leaveSelection} />
            </>
          ) : (
            <>
              {sessions.some((session) => session.archived) ? (
                <div className="flex rounded-full bg-muted/70 p-0.5 text-[10px]">
                  <button type="button" className={cn("rounded-full px-2 py-0.5", !showArchived && "bg-background text-foreground shadow-sm")} onClick={() => setShowArchived(false)}>{t("sidepanel.sessions.active")}</button>
                  <button type="button" className={cn("rounded-full px-2 py-0.5", showArchived && "bg-background text-foreground shadow-sm")} onClick={() => setShowArchived(true)}>{t("sidepanel.sessions.archived")}</button>
                </div>
              ) : <span className="flex-1" />}
              <span className="flex-1" />
              {onImport ? <BulkButton label={t("sidepanel.sessions.import")} icon={<Upload />} onClick={() => fileInputRef.current?.click()} /> : null}
              {onBulkAction ? <BulkButton label={t("sidepanel.sessions.select")} icon={<CheckSquare />} onClick={() => setSelecting(true)} /> : null}
              <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file && onImport) void onImport(file);
              }} />
            </>
          )}
        </div>
      ) : null}
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
          const configuredLimit =
            visibleLimits[sec.source] ?? HISTORY_PAGE_SIZE;
          const activeIndex = sec.items.findIndex((s) => s.id === activeId);
          const visibleLimit =
            activeIndex >= configuredLimit
              ? Math.ceil((activeIndex + 1) / HISTORY_PAGE_SIZE) *
                HISTORY_PAGE_SIZE
              : configuredLimit;
          const visible = sec.items.slice(0, visibleLimit);
          const hiddenCount = sec.items.length - visible.length;
          const rows = (
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
                    onDelete={() => onDelete(s.id)}
                    onPin={onPin ? (pinned) => onPin(s.id, pinned) : undefined}
                    onArchive={onArchive ? (archived) => onArchive(s.id, archived) : undefined}
                    onBranch={onBranch ? () => onBranch(s.id) : undefined}
                    onExport={onExport ? () => onExport(s.id) : undefined}
                    selecting={selecting}
                    selected={selected.has(s.id)}
                    onToggleSelected={() => toggleSelected(s.id)}
                    icon={rowIconFor?.(s)}
                    nested={indentRows}
                    allowActions={allowActionsFor?.(s) ?? true}
                  />
                ))}
              </nav>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  onClick={() => showMore(sec.source)}
                  className="mx-0.5 flex h-7 items-center rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  {t("sidepanel.sessions.showMore")}
                </button>
              ) : null}
            </>
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

interface SessionRowProps {
  session: SessionMeta;
  running: boolean;
  failed: boolean;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onPin?: (pinned: boolean) => void | Promise<void>;
  onArchive?: (archived: boolean) => void | Promise<void>;
  onBranch?: () => void | Promise<void>;
  onExport?: () => void | Promise<void>;
  selecting: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  icon?: ReactNode;
  nested?: boolean;
  allowActions: boolean;
}

function SessionRow({
  session,
  running,
  failed,
  active,
  onOpen,
  onRename,
  onDelete,
  onPin,
  onArchive,
  onBranch,
  onExport,
  selecting,
  selected,
  onToggleSelected,
  icon,
  nested,
  allowActions,
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
      {nested && statusLabel ? (
        <span
          aria-label={statusLabel}
          title={statusLabel}
          className="pointer-events-none absolute left-2 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center"
        >
          {statusGlyph}
        </span>
      ) : null}
      <button
        type="button"
        onClick={selecting ? onToggleSelected : onOpen}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 pr-2 text-left focus-visible:outline-none",
          nested ? "pl-8" : "pl-2",
        )}
      >
        {selecting ? (
          <span className={cn("inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border", selected && "border-foreground bg-foreground text-background")}>
            {selected ? <CheckSquare className="h-3 w-3" /> : null}
          </span>
        ) : null}
        {!nested && statusLabel ? (
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
        {session.pinned && !selecting ? <Pin className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
      </button>
      {allowActions && !selecting ? (
        <span className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
            title={t("chat.rename")}
            aria-label={t("chat.rename")}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" onClick={(event) => event.stopPropagation()} className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground" title={t("workspacePane.moreActions")} aria-label={t("workspacePane.moreActions")}><MoreHorizontal className="h-3.5 w-3.5" /></button>
            </PopoverTrigger>
            <PopoverContent align="end" size="narrow" padding="sm" className="space-y-0.5">
              {onPin ? <PopoverClose asChild><SessionMenuButton icon={session.pinned ? <PinOff /> : <Pin />} label={session.pinned ? t("sidepanel.sessions.unpin") : t("sidepanel.sessions.pin")} onClick={() => void onPin(!session.pinned)} /></PopoverClose> : null}
              {onArchive ? <PopoverClose asChild><SessionMenuButton icon={session.archived ? <ArchiveRestore /> : <Archive />} label={session.archived ? t("sidepanel.sessions.unarchive") : t("sidepanel.sessions.archive")} onClick={() => void onArchive(!session.archived)} /></PopoverClose> : null}
              {onBranch ? <PopoverClose asChild><SessionMenuButton icon={<GitBranch />} label={t("sidepanel.sessions.branch")} onClick={() => void onBranch()} /></PopoverClose> : null}
              {onExport ? <PopoverClose asChild><SessionMenuButton icon={<Download />} label={t("sidepanel.sessions.export")} onClick={() => void onExport()} /></PopoverClose> : null}
              <PopoverClose asChild><SessionMenuButton destructive icon={<Trash2 />} label={t("chat.delete")} onClick={() => {
                if (confirm(t("sidepanel.sessions.deleteConfirm", { title: session.title?.trim() || t("chat.untitled") }))) onDelete();
              }} /></PopoverClose>
            </PopoverContent>
          </Popover>
        </span>
      ) : null}
    </div>
  );
}

function BulkButton({
  label,
  icon,
  disabled,
  destructive,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5", destructive && "hover:bg-destructive/10 hover:text-destructive")}>
      {icon}
    </button>
  );
}

function SessionMenuButton({
  icon,
  label,
  destructive,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }} className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground/80 hover:bg-accent", destructive && "text-destructive hover:bg-destructive/10")}>
      <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
