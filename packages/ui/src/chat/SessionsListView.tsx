/**
 * Channel-grouped session list — the shared body shared by the Chats
 * and Scheduled-tasks activity views. The two surfaces differ only in
 * their data source (chats: `useSessions` with cron excluded; scheduled:
 * `useCronSessions` converted to `SessionMeta`). UI, sectioning, date
 * buckets, hover affordances are identical.
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
} from "react";

import {
  resolveChannel,
  SOURCE_LOCAL,
  type SessionMeta,
} from "@hermes-x/core";
import { useT, type MessageKey } from "@hermes-x/i18n";
import { Input, cn } from "../primitives";
import {
  ResizableSectionList,
  type ResizableItem,
} from "./internal/ResizableSectionList";
import { TopSection } from "./SessionGroups";

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
      const src = s.source ?? SOURCE_LOCAL;
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
      sections.push({ source: src, label: labelFor(src), items, isLocal: false });
    }
    return sections;
  }, [sessions, query, t, sectionLabelFor]);

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
      <div className="px-3 py-3 text-[11px] text-muted-foreground">
        {t("chat.loadingSessions")}
      </div>
    );
  }

  const emptyText = query
    ? (noMatchesLabel ?? t("chat.noMatches"))
    : (emptyLabel ?? t("chat.noSessions"));

  return (
    <ResizableSectionList
      items={(() => {
        const items: ResizableItem[] = [];
        if (totalMatching === 0) {
          // Single placeholder section — the local channel header with
          // an empty body so the user has a visible anchor.
          const localName = (() => {
            const d = resolveChannel(SOURCE_LOCAL);
            const tr = t(d.labelKey as MessageKey);
            return tr === d.labelKey ? d.fallbackLabel : tr;
          })();
          items.push({
            id: SOURCE_LOCAL,
            collapsed: !!topCollapsed[SOURCE_LOCAL],
            render: () => (
              <TopSection
                label={t("sidepanel.sessions.group.channelChats", {
                  name: localName,
                })}
                count={0}
                collapsed={!!topCollapsed[SOURCE_LOCAL]}
                onToggle={() => toggleTop(SOURCE_LOCAL)}
                variant="rail"
                flex
              >
                <p className="px-3 py-3 text-[11px] text-muted-foreground">
                  {emptyText}
                </p>
              </TopSection>
            ),
          });
        } else {
          for (const sec of channelSections) {
            items.push({
              id: sec.source,
              collapsed: !!topCollapsed[sec.source],
              render: () => (
                <TopSection
                  label={sec.label}
                  count={sec.items.length}
                  collapsed={!!topCollapsed[sec.source]}
                  onToggle={() => toggleTop(sec.source)}
                  variant="rail"
                  flex
                >
                  <nav className="flex flex-col">
                    {sec.items.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        active={s.id === activeId}
                        onOpen={() => onOpen(s.id)}
                        onRename={(title) => onRename(s.id, title)}
                        onDelete={() => onDelete(s.id)}
                      />
                    ))}
                  </nav>
                </TopSection>
              ),
            });
          }
        }
        return items;
      })()}
    />
  );
}

interface SessionRowProps {
  session: SessionMeta;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

function SessionRow({
  session,
  active,
  onOpen,
  onRename,
  onDelete,
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
          "group flex items-center gap-1 px-3 py-1.5",
          active && "bg-muted/70",
        )}
      >
        <StatusDot />
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          className="h-6 min-w-0 flex-1 px-1.5 text-xs"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      <StatusDot />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {session.title?.trim() || t("chat.untitled")}
      </span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground"
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
          className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
          title={t("chat.delete")}
          aria-label={t("chat.delete")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
      <span className="inline-flex w-6 shrink-0 items-center justify-center text-[9px] tabular-nums text-muted-foreground/70 group-hover:hidden">
        {formatRelativeShort(session.updatedAt)}
      </span>
    </button>
  );
}

/**
 * Leading status indicator slot for each session row. Renders an empty
 * outlined circle by default; a follow-up pass will colour it (success,
 * error, running, etc.) once per-session status flows through. Sized to
 * match the previous `MessageSquare` icon's gap so row geometry stays
 * stable.
 */
function StatusDot() {
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40"
    />
  );
}

function formatRelativeShort(ms: number | undefined): string {
  if (!ms) return "";
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 60) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
