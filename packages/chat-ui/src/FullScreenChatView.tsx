/**
 * Full-screen chat surface — a thin top bar above a two-pane body
 * (sessions rail on the left, chat on the right). The chat itself is
 * `<SidePanelView variant="fullscreen">` so it skips its own TabBar
 * (this rail handles session switching) and fills its parent vertically.
 *
 * Both panes share session state through the PlatformAdapter's storage
 * watch — the sessions rail and the SidePanelView each instantiate their
 * own `useSessions`, but writes propagate via the underlying storage
 * change-broadcast mechanism.
 *
 * Extension uses this as the standalone ``tabs/chat.html`` page; desktop
 * uses it as the chat view inside the main BrowserWindow.
 */

import { Home, MessageSquare, Pencil, Plus, Search, Settings, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  useSessions,
  type ChatEngineClient,
  type SessionMeta,
} from "@hermes-x/core";
import { useT, type TranslateFn } from "@hermes-x/i18n";
import { getPlatform, type StorageChangeMap } from "@hermes-x/platform";
import { useResolvedTheme } from "@hermes-x/theme";
import { Input, ScrollArea } from "@hermes-x/ui";
import { cn } from "@hermes-x/utils";

import type { SidePanelCapabilities } from "./internal/capabilities";
import type { MessagesMaxWidth } from "./internal/types";
import SidePanelView from "./SidePanelView";

const MESSAGES_WIDTH_KEY = "settings.chat.messagesWidth";
const DEFAULT_MESSAGES_WIDTH: MessagesMaxWidth = "comfortable";

function widthOptions(
  t: TranslateFn,
): Array<{ value: MessagesMaxWidth; label: string; tooltip: string }> {
  return [
    {
      value: "narrow",
      label: t("chat.width.narrow"),
      tooltip: t("chat.width.narrow.tooltip"),
    },
    {
      value: "comfortable",
      label: t("chat.width.medium"),
      tooltip: t("chat.width.medium.tooltip"),
    },
    {
      value: "full",
      label: t("chat.width.full"),
      tooltip: t("chat.width.full.tooltip"),
    },
  ];
}

function isMessagesMaxWidth(v: unknown): v is MessagesMaxWidth {
  return v === "narrow" || v === "comfortable" || v === "full";
}

export interface FullScreenChatViewProps {
  /** ChatEngineClient — extension wraps chrome.runtime.connect, desktop wraps IPC. */
  client: ChatEngineClient;
  /** Optional extension-only capabilities (page-context, learn, etc.). */
  capabilities?: SidePanelCapabilities;
  /** Slots forwarded to SidePanelView (BridgeStatusBar / NavigateOpenPolicyToggle). */
  slots?: {
    bridgeBar?: ReactNode;
    navigateOpenPolicyToggle?: (ctx: {
      policy: import("./internal/capabilities").NavigateOpenPolicy;
      onChange: (next: import("./internal/capabilities").NavigateOpenPolicy) => void;
    }) => ReactNode;
  };
  /** TabBar gear / top-bar gear → open Settings. */
  openSettings: () => void;
  /** AgentDestinationChip — open URL in user's primary browser. */
  openAgentDestination: (url: string) => void | Promise<void>;
  /**
   * Optional top-bar logo click → navigate back to Home. When omitted,
   * the logo renders as a non-clickable header.
   */
  onGoHome?: () => void;
  /**
   * Pixel reserve on the left edge of the top header so OS chrome
   * (macOS traffic lights when running inside Electron with a hidden
   * native title bar) doesn't visually collide with the logo. Default
   * 0; desktop passes ~78 on mac.
   */
  topBarLeftInset?: number;
  /**
   * Top bar row height in pixels. Defaults to 24 (compact, matches
   * extension/web layouts). Desktop overrides to 40 so the centred
   * h-6 buttons land on the macOS traffic-light baseline (y=20).
   */
  topBarHeightPx?: number;
  /**
   * Extra className applied to the top header. Desktop passes
   * `app-drag-region` so the user can drag the window from the header
   * (buttons inside opt out automatically via the global CSS rule).
   */
  topBarClassName?: string;
}

export default function FullScreenChatView({
  client,
  capabilities,
  slots,
  openSettings,
  openAgentDestination,
  onGoHome,
  topBarLeftInset,
  topBarHeightPx,
  topBarClassName,
}: FullScreenChatViewProps) {
  useResolvedTheme();
  const sessions = useSessions();
  const [query, setQuery] = useState("");
  const [messagesWidth, setMessagesWidth] = useState<MessagesMaxWidth>(
    DEFAULT_MESSAGES_WIDTH,
  );

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get(MESSAGES_WIDTH_KEY).then((r) => {
      if (cancelled) return;
      const v = r[MESSAGES_WIDTH_KEY];
      if (isMessagesMaxWidth(v)) setMessagesWidth(v);
    });
    const unsub = storage.watch([MESSAGES_WIDTH_KEY], (changes: StorageChangeMap) => {
      const ch = changes[MESSAGES_WIDTH_KEY];
      if (ch && isMessagesMaxWidth(ch.newValue)) setMessagesWidth(ch.newValue);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  function onWidthChange(next: MessagesMaxWidth) {
    setMessagesWidth(next);
    void getPlatform().storage.set({ [MESSAGES_WIDTH_KEY]: next });
  }

  const onNewChat = useCallback(async () => {
    if (!sessions.ready) return;
    await sessions.createNew();
  }, [sessions]);

  const onOpenSession = useCallback(
    async (id: string) => {
      if (!sessions.ready) return;
      await sessions.openTab(id);
    },
    [sessions],
  );

  return (
    <div className="flex h-screen min-h-0 w-full bg-background text-foreground">
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border/60 bg-muted/15">
        <SidebarHeader
          onGoHome={onGoHome}
          leftInset={topBarLeftInset}
          heightPx={topBarHeightPx}
          className={topBarClassName}
        />
        <SessionsRail
          sessions={sessions.sessions}
          activeId={sessions.activeId}
          ready={sessions.ready}
          query={query}
          onQuery={setQuery}
          onOpen={(id) => void onOpenSession(id)}
          onRename={(id, title) => void sessions.rename(id, title)}
          onDelete={(id) => void sessions.remove(id)}
        />
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MainActionsBar
          messagesWidth={messagesWidth}
          onMessagesWidthChange={onWidthChange}
          onNewChat={() => void onNewChat()}
          onOpenSettings={openSettings}
          heightPx={topBarHeightPx}
          className={topBarClassName}
        />
        <SidePanelView
          variant="fullscreen"
          messagesMaxWidth={messagesWidth}
          client={client}
          capabilities={capabilities}
          slots={slots}
          openSettings={openSettings}
          openAgentDestination={openAgentDestination}
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bars — sidebar header (Home / drag region) + main actions strip
// ---------------------------------------------------------------------------

interface SidebarHeaderProps {
  /** Optional — when present, renders a Home button pinned to the right. */
  onGoHome?: () => void;
  /** Extra left padding so the row clears desktop OS chrome (mac traffic lights). */
  leftInset?: number;
  /** Row height in px. Default 24 (compact). Desktop passes 44 so the
   *  centred h-6 Home button (centre y=22) lines up with the macOS
   *  traffic-light cluster pinned at (20, 14). */
  heightPx?: number;
  /** Extra className (desktop passes `app-drag-region`). */
  className?: string;
}

/**
 * Sidebar header — mirrors `SettingsView`'s sidebar header so the chat
 * and settings views feel identical: a passive drag strip on the left
 * (where macOS overlays the traffic lights), Home button on the right.
 */
function SidebarHeader({
  onGoHome,
  leftInset = 0,
  heightPx = 24,
  className,
}: SidebarHeaderProps) {
  const { t } = useT();
  return (
    <div
      className={cn("flex shrink-0 items-center justify-end pr-2", className)}
      style={{
        height: heightPx,
        paddingLeft: Math.max(leftInset, 12),
      }}
    >
      {onGoHome && (
        <button
          type="button"
          onClick={onGoHome}
          title={t("chat.goHome")}
          aria-label={t("chat.goHome")}
          className="app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Home className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface MainActionsBarProps {
  messagesWidth: MessagesMaxWidth;
  onMessagesWidthChange: (next: MessagesMaxWidth) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  /** Row height in px. Default 24 (compact). Desktop passes 44 to match
   *  the sidebar header so both rows form a single horizontal chrome line. */
  heightPx?: number;
  /** Extra className (desktop passes `app-drag-region`). */
  className?: string;
}

/**
 * Right-side actions strip above the chat pane: new chat / width toggle /
 * Settings gear. Same row height as the sidebar header so they read as
 * one continuous title-bar line across the window.
 */
function MainActionsBar({
  messagesWidth,
  onMessagesWidthChange,
  onNewChat,
  onOpenSettings,
  heightPx = 24,
  className,
}: MainActionsBarProps) {
  const { t } = useT();
  return (
    <header
      className={cn("flex shrink-0 items-center justify-end gap-1 px-2", className)}
      style={{ height: heightPx }}
    >
      <button
        type="button"
        onClick={onNewChat}
        className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title={t("chat.newChat")}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("sidepanel.tabbar.button.new")}
      </button>
      <WidthToggle value={messagesWidth} onChange={onMessagesWidthChange} />
      <button
        type="button"
        onClick={onOpenSettings}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={t("chat.openOptions")}
        title={t("chat.openOptions")}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </header>
  );
}

/**
 * Three icon buttons laid out inline next to the other top-bar icons —
 * same `h-8 w-8` cell size, same hover behavior, just an active-state
 * fill to mark the current preset. No outer border / chip so the
 * control reads at the same visual weight as `⛶ pop back` and `⚙`.
 */
function WidthToggle({
  value,
  onChange,
}: {
  value: MessagesMaxWidth;
  onChange: (next: MessagesMaxWidth) => void;
}) {
  const { t } = useT();
  const options = widthOptions(t);
  return (
    <div
      role="radiogroup"
      aria-label={t("chat.width.label")}
      className="flex items-center"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            title={opt.tooltip}
            aria-label={opt.tooltip}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <WidthBars value={opt.value} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tiny inline width indicator: a horizontal bar whose visible portion
 * grows with the preset. Pure CSS — no extra dependency on an icon set
 * that doesn't ship something this specific.
 */
function WidthBars({ value }: { value: MessagesMaxWidth }) {
  const span = value === "narrow" ? "w-1.5" : value === "comfortable" ? "w-3" : "w-4";
  return (
    <span className="relative inline-block h-2.5 w-4 overflow-hidden rounded-[2px] border border-current">
      <span className={cn("absolute inset-y-0 left-0 bg-current", span)} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Right rail — sessions list
// ---------------------------------------------------------------------------

interface SessionsRailProps {
  sessions: SessionMeta[];
  activeId: string;
  ready: boolean;
  query: string;
  onQuery: (v: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Vertical session list grouped by recency (Today / Yesterday / Older).
 * Selecting an entry hands the click off to the SidePanel via shared
 * session state (storage-backed) — there is no direct cross-component
 * messaging here, just side-effects through ``chrome.storage``.
 */
function SessionsRail({
  sessions,
  activeId,
  ready,
  query,
  onQuery,
  onOpen,
  onRename,
  onDelete,
}: SessionsRailProps) {
  const { t } = useT();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const live = sessions.filter((s) => !s.archived);
    if (!q) return live;
    return live.filter((s) =>
      (s.title || t("chat.untitled")).toLowerCase().includes(q),
    );
  }, [sessions, query, t]);

  const groups = useMemo(() => groupByRecency(filtered, t), [filtered, t]);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("chat.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("chat.searchClear")}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {!ready ? (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">
            {t("chat.loadingSessions")}
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">
            {query ? t("chat.noMatches") : t("chat.noSessions")}
          </p>
        ) : (
          <nav className="flex flex-col py-1">
            {groups.map((g) =>
              g.items.length === 0 ? null : (
                <div key={g.key} className="flex flex-col">
                  <p className="px-3 pt-2.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {g.label}
                  </p>
                  {g.items.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      active={s.id === activeId}
                      onOpen={() => onOpen(s.id)}
                      onRename={(title) => onRename(s.id, title)}
                      onDelete={() => onDelete(s.id)}
                    />
                  ))}
                </div>
              ),
            )}
          </nav>
        )}
      </ScrollArea>
    </>
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

  // Re-sync the rename draft when the upstream title changes (e.g. the
  // auto-title generator wrote a fresh value while we weren't editing).
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
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <MessageSquare className="h-3.5 w-3.5 shrink-0" />
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
      <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/70 group-hover:hidden">
        {formatRelativeShort(session.updatedAt)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SessionGroup {
  key: "today" | "yesterday" | "older";
  label: string;
  items: SessionMeta[];
}

/**
 * Bucket sessions into Today / Yesterday / Older based on `updatedAt`.
 * Within each bucket, newest first (the input arrives in whatever order
 * `useSessions` returned — we sort defensively).
 */
function groupByRecency(
  sessions: SessionMeta[],
  t: TranslateFn,
): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const groups: SessionGroup[] = [
    { key: "today", label: t("chat.group.today"), items: [] },
    { key: "yesterday", label: t("chat.group.yesterday"), items: [] },
    { key: "older", label: t("chat.group.older"), items: [] },
  ];

  for (const s of sessions) {
    const ts = s.updatedAt ?? 0;
    if (ts >= startOfToday) groups[0].items.push(s);
    else if (ts >= startOfYesterday) groups[1].items.push(s);
    else groups[2].items.push(s);
  }
  for (const g of groups) {
    g.items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  return groups;
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

