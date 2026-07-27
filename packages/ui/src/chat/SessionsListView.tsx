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

import { Pencil, Trash2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { resolveChannel, SOURCE_LOCAL, type SessionMeta } from "@amiba/core";
import { useT, type MessageKey } from "@amiba/i18n";
import { Input, cn } from "../primitives";
import { TopSection } from "./SessionGroups";

const HISTORY_PAGE_SIZE = 20;

export interface SessionsListViewProps {
  sessions: SessionMeta[];
  activeId: string;
  ready: boolean;
  query: string;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
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
  activeId,
  ready,
  query,
  onOpen,
  onRename,
  onDelete,
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
    const live = sessions.filter((s) => !s.archived);
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
                    active={s.id === activeId}
                    onOpen={() => onOpen(s.id)}
                    onRename={(title) => onRename(s.id, title)}
                    onDelete={() => onDelete(s.id)}
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
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  icon?: ReactNode;
  nested?: boolean;
  allowActions: boolean;
}

function SessionRow({
  session,
  active,
  onOpen,
  onRename,
  onDelete,
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
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 pr-2 text-left focus-visible:outline-none",
          nested ? "pl-8" : "pl-2",
        )}
      >
        {icon ? (
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70 [&_svg]:h-3.5 [&_svg]:w-3.5">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[13px] font-normal">
          {session.title?.trim() || t("chat.untitled")}
        </span>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground/70 transition-opacity",
            allowActions &&
              "group-hover:opacity-0 group-focus-within:opacity-0",
          )}
        >
          {formatRelativeShort(session.updatedAt)}
        </span>
      </button>
      {allowActions ? (
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (
                confirm(
                  `Delete "${session.title?.trim() || "this chat"}"? This removes it from history.`,
                )
              ) {
                onDelete();
              }
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
            title={t("chat.delete")}
            aria-label={t("chat.delete")}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      ) : null}
    </div>
  );
}

function formatRelativeShort(ms: number | undefined): string {
  if (!ms) return "";
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 60) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d`;
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}
