import {
  Check,
  Pencil,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@hermes-x/ui";
import { ScrollArea } from "@hermes-x/ui";
import { useT, type MessageKey, type TranslateFn } from "@hermes-x/i18n";
import {
  resolveChannel,
  type SessionMeta,
} from "@hermes-x/core";
import { cn } from "@hermes-x/utils";

import { ScheduledSection, TopSection } from "./SessionGroups";

interface Props {
  open: boolean;
  sessions: SessionMeta[];
  /** ids currently shown as tabs in the header (not deleted, just maybe closed). */
  openTabIds: string[];
  activeId: string;
  onClose: () => void;
  /** Open the session as a tab and activate it. */
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  /** Permanent delete: drops the session from history + closes its tab. */
  onDelete: (id: string) => void;
  /**
   * Open a cron-source session as a tab. The drawer queries SessionDB
   * directly for cron sessions (one canonical source, matches
   * ``hermes sessions list --source cron``), so the caller just needs
   * to ``sessions.openTab(id)``. Optional: surfaces that don't expose
   * cron tasks (e.g. the slim ChatView) can omit this and the
   * Scheduled section stays hidden.
   */
  onOpenCronSession?: (sessionId: string) => void;
  /**
   * Re-fetch the session index. Fires once each time the drawer opens
   * so multi-channel rows authored elsewhere (gateway / CLI / cron)
   * appear without waiting for the next storage-watch broadcast. Wired
   * by the host to ``sessions.refresh``; omit when the host doesn't
   * want a refresh on open.
   */
  onRefresh?: () => void | Promise<void>;
}

interface DateBucket {
  label: string;
  items: SessionMeta[];
}

/**
 * Bins sessions by `updatedAt` into Pinned + Today / Yesterday /
 * Earlier this week / This month / Older. Mirrors the grouping the
 * Hermes WebUI uses; gives the sidebar a familiar structure even when
 * there are dozens of sessions.
 */
function groupSessionsByDate(
  sessions: SessionMeta[],
  t: TranslateFn,
): DateBucket[] {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const sevenDays = today - 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = today - 30 * 24 * 60 * 60 * 1000;

  const buckets: DateBucket[] = [
    { label: t("sidepanel.sessions.group.today"), items: [] },
    { label: t("sidepanel.sessions.group.yesterday"), items: [] },
    { label: t("sidepanel.sessions.group.earlierWeek"), items: [] },
    { label: t("sidepanel.sessions.group.thisMonth"), items: [] },
    { label: t("sidepanel.sessions.group.older"), items: [] },
  ];

  // Pinned items always come first regardless of date.
  const pinned: SessionMeta[] = [];
  const rest: SessionMeta[] = [];
  for (const s of sessions) {
    if (s.archived) continue;
    // Cron-run sessions belong only in the Scheduled-tasks group;
    // skip them here so they don't double-appear in the chat history.
    if (s.id.startsWith("cron_")) continue;
    if (s.pinned) pinned.push(s);
    else rest.push(s);
  }

  const sortByUpdated = (a: SessionMeta, b: SessionMeta) =>
    b.updatedAt - a.updatedAt;
  pinned.sort(sortByUpdated);
  rest.sort(sortByUpdated);

  for (const s of rest) {
    if (s.updatedAt >= today) buckets[0].items.push(s);
    else if (s.updatedAt >= yesterday) buckets[1].items.push(s);
    else if (s.updatedAt >= sevenDays) buckets[2].items.push(s);
    else if (s.updatedAt >= thirtyDays) buckets[3].items.push(s);
    else buckets[4].items.push(s);
  }

  const out: DateBucket[] = [];
  if (pinned.length)
    out.push({ label: t("sidepanel.sessions.group.pinned"), items: pinned });
  for (const b of buckets) if (b.items.length) out.push(b);
  return out;
}

export function SessionDrawer({
  open,
  sessions,
  openTabIds,
  activeId,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onOpenCronSession,
  onRefresh,
}: Props) {
  const { t } = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  /**
   * Per-section collapse state. Keyed by SessionDB source so adding a
   * new channel surface doesn't clobber the user's collapse choices for
   * existing ones. ``scheduled`` is the only fixed key.
   */
  const [topCollapsed, setTopCollapsed] = useState<Record<string, boolean>>({
    scheduled: false,
  });
  const toggleTop = (id: string) =>
    setTopCollapsed((p) => ({ ...p, [id]: !p[id] }));

  // Drop the editing state when the drawer closes; otherwise reopening
  // would land us in stale rename mode.
  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setEditingValue("");
    }
  }, [open]);

  // Refresh the index once per drawer-open so multi-channel rows
  // authored elsewhere (gateway / CLI / cron) appear immediately —
  // sessions-runtime only fetches on initial mount otherwise.
  useEffect(() => {
    if (!open || !onRefresh) return;
    void onRefresh();
  }, [open, onRefresh]);

  /**
   * Sessions split by originating channel. Each channel becomes its own
   * top-level section; date-bucket grouping (Today / Yesterday / …) lives
   * inside each section. Local sessions (``browser-extension`` /
   * ``desktop``) keep the existing "Chats" label so single-channel users
   * see the same UI they always had; remote channels render as
   * additional sections labelled with the channel name.
   */
  const channelSections = useMemo(() => {
    const live = sessions.filter(
      (s) => !s.archived && !s.id.startsWith("cron_"),
    );

    const bySource = new Map<string, SessionMeta[]>();
    for (const s of live) {
      const src = s.source ?? "browser-extension";
      const arr = bySource.get(src) ?? [];
      arr.push(s);
      bySource.set(src, arr);
    }

    const localSources = ["browser-extension", "desktop"];
    const sections: {
      source: string;
      label: string;
      items: SessionMeta[];
    }[] = [];
    const labelFor = (src: string): string => {
      const descriptor = resolveChannel(src);
      const channelTranslated = t(descriptor.labelKey as MessageKey);
      const channelName =
        channelTranslated === descriptor.labelKey
          ? descriptor.fallbackLabel
          : channelTranslated;
      return t("sidepanel.sessions.group.channelChats", { name: channelName });
    };
    for (const src of localSources) {
      const items = bySource.get(src);
      if (!items) continue;
      sections.push({ source: src, label: labelFor(src), items });
    }
    const remote = Array.from(bySource.entries())
      .filter(([src]) => !localSources.includes(src))
      .sort((a, b) => b[1].length - a[1].length);
    for (const [src, items] of remote) {
      sections.push({ source: src, label: labelFor(src), items });
    }
    return sections;
  }, [sessions, t]);

  const openSet = useMemo(() => new Set(openTabIds), [openTabIds]);
  const totalCount = useMemo(
    () => channelSections.reduce((s, sec) => s + sec.items.length, 0),
    [channelSections],
  );

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-background"
      role="dialog"
      aria-label={t("sidepanel.sessions.dialogAria")}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">
          {t("sidepanel.sessions.title")}
        </h2>
        <div className="ml-auto">
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            title={t("sidepanel.sessions.close")}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-2 space-y-2">
            {totalCount === 0 ? (
              <TopSection
                label={t("sidepanel.sessions.group.channelChats", {
                  name: (() => {
                    const d = resolveChannel("browser-extension");
                    const tr = t(d.labelKey as MessageKey);
                    return tr === d.labelKey ? d.fallbackLabel : tr;
                  })(),
                })}
                count={0}
                collapsed={!!topCollapsed["browser-extension"]}
                onToggle={() => toggleTop("browser-extension")}
              >
                <div className="mx-2 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  {t("sidepanel.sessions.empty")}
                </div>
              </TopSection>
            ) : (
              channelSections.map((sec) => {
                const dateBuckets = groupSessionsByDate(sec.items, t);
                return (
                  <TopSection
                    key={sec.source}
                    label={sec.label}
                    count={sec.items.length}
                    collapsed={!!topCollapsed[sec.source]}
                    onToggle={() => toggleTop(sec.source)}
                  >
                    {dateBuckets.map((g) => (
                      <div key={g.label} className="mb-2">
                        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {g.label}
                        </div>
                        <ul className="space-y-0.5">
                          {g.items.map((s) => (
                            <SessionRow
                              key={s.id}
                              session={s}
                              active={s.id === activeId}
                              isOpen={openSet.has(s.id)}
                              editing={editingId === s.id}
                              editingValue={editingValue}
                              onEditingValueChange={setEditingValue}
                              onOpen={() => {
                                onOpen(s.id);
                                onClose();
                              }}
                              onStartEdit={() => {
                                setEditingId(s.id);
                                setEditingValue(s.title || "");
                              }}
                              onCommitEdit={() => {
                                const trimmed = editingValue.trim();
                                if (trimmed) onRename(s.id, trimmed);
                                setEditingId(null);
                              }}
                              onCancelEdit={() => setEditingId(null)}
                              onDelete={() => onDelete(s.id)}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </TopSection>
                );
              })
            )}

            {onOpenCronSession && (
              <ScheduledSection
                open={open && !topCollapsed.scheduled}
                collapsed={!!topCollapsed.scheduled}
                onToggle={() => toggleTop("scheduled")}
                activeId={activeId}
                onOpenCronSession={(id) => {
                  onOpenCronSession(id);
                  onClose();
                }}
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

/* ─────────────────────────── Chat session row (unchanged structure) */

interface RowProps {
  session: SessionMeta;
  active: boolean;
  /** Currently shown as a tab (not just kept in history). */
  isOpen: boolean;
  editing: boolean;
  editingValue: string;
  onEditingValueChange: (v: string) => void;
  onOpen: () => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function SessionRow({
  session,
  active,
  isOpen,
  editing,
  editingValue,
  onEditingValueChange,
  onOpen,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDelete,
}: RowProps) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const displayTitle = session.title || t("sidepanel.sessions.newChatTitle");

  return (
    <li
      className={cn(
        "group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/60 hover:text-accent-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
          isOpen ? "bg-foreground/40" : "bg-transparent",
        )}
        title={isOpen ? t("sidepanel.sessions.openAsTab") : ""}
      />

      {editing ? (
        <input
          ref={inputRef}
          value={editingValue}
          onChange={(e) => onEditingValueChange(e.target.value)}
          onKeyDown={(e) => {
            const ne = e.nativeEvent;
            if (ne.isComposing || e.key === "Process") {
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left"
          title={displayTitle}
        >
          <span className="truncate">{displayTitle}</span>
        </button>
      )}

      {editing ? (
        <>
          <RowAction
            icon={Check}
            title={t("sidepanel.sessions.save")}
            onClick={onCommitEdit}
          />
          <RowAction
            icon={X}
            title={t("sidepanel.sessions.cancel")}
            onClick={onCancelEdit}
          />
        </>
      ) : (
        <div
          className={cn(
            "flex items-center gap-0.5 opacity-0 transition-opacity",
            active ? "opacity-100" : "group-hover:opacity-100",
          )}
        >
          <RowAction
            icon={Pencil}
            title={t("sidepanel.sessions.rename")}
            onClick={onStartEdit}
          />
          <RowAction
            icon={Trash2}
            title={t("sidepanel.sessions.deletePermanently")}
            onClick={() => {
              if (
                confirm(
                  t("sidepanel.sessions.deleteConfirm", {
                    title: displayTitle,
                  }),
                )
              ) {
                onDelete();
              }
            }}
          />
        </div>
      )}
    </li>
  );
}

function RowAction({
  icon: Icon,
  title,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-1 hover:bg-foreground/10"
      title={title}
      aria-label={title}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

