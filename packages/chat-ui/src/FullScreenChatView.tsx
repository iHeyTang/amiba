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
  resolveChannel,
  useSessions,
  type ChatEngineClient,
  type SessionMeta,
} from "@hermes-x/core";
import { useT, type MessageKey, type TranslateFn } from "@hermes-x/i18n";
import { getPlatform, type StorageChangeMap } from "@hermes-x/platform";
import { useResolvedTheme } from "@hermes-x/theme";
import { Input } from "@hermes-x/ui";
import { cn } from "@hermes-x/utils";

import type { SidePanelCapabilities } from "./internal/capabilities";
import {
  ResizableSectionList,
  type ResizableItem,
} from "./internal/ResizableSectionList";
import type { MessagesMaxWidth } from "./internal/types";
import { ScheduledSection, TopSection } from "./SessionGroups";
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
  /** Slots forwarded to SidePanelView (BridgeStatusBar / NavigateOpenPolicyToggle / empty-state). */
  slots?: {
    bridgeBar?: ReactNode;
    navigateOpenPolicyToggle?: (ctx: {
      policy: import("./internal/capabilities").NavigateOpenPolicy;
      onChange: (next: import("./internal/capabilities").NavigateOpenPolicy) => void;
    }) => ReactNode;
    /**
     * Rendered in the main pane when no session is active. Desktop hands
     * in ``<HomeView panelMode />`` so the home composer doubles as the
     * empty state instead of a separate route.
     */
    emptyState?: ReactNode;
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

  // Active session title for the top-bar centre. Empty when no session
  // is active; the MainActionsBar uses that as a "no chat yet" signal
  // and renders the wordmark instead.
  const activeTitle = useMemo(() => {
    if (!sessions.activeId) return "";
    const found = sessions.sessions.find((s) => s.id === sessions.activeId);
    return found?.title?.trim() || "";
  }, [sessions.activeId, sessions.sessions]);

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

  // Rail row click: toggle. Picking an already-active row deselects
  // it and lands the right pane on the home / empty-state surface —
  // symmetrical with picking a row to select. Picking a different row
  // (or an unopened one) opens + activates as usual.
  const onOpenSession = useCallback(
    async (id: string) => {
      if (!sessions.ready) return;
      if (id === sessions.activeId) {
        await sessions.deselect();
        return;
      }
      await sessions.openTab(id);
    },
    [sessions],
  );

  // Cron session click → same toggle semantics as a regular row. The
  // rail lists cron sessions straight from SessionDB
  // (``listHermesSessions({ source: "cron" })``), so the session row
  // already exists; no synthesis or pending-prompt hand-off needed.
  const onOpenCronSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!sessions.ready) return;
      if (sessionId === sessions.activeId) {
        await sessions.deselect();
        return;
      }
      await sessions.openTab(sessionId);
    },
    [sessions],
  );

  // Layout: a single top bar spans the full window width, with the
  // body row (sidebar | main) sitting below it. Previously the sidebar
  // had its own header strip and the main pane had a separate top bar,
  // producing an L-shaped chrome split at the sidebar/main boundary —
  // the unified bar reads as one continuous OS-chrome row, which is
  // what the desktop window actually wants (macOS traffic lights
  // overlay the top-left corner; the row containing them naturally
  // spans the whole window above the body content).
  // Visual layering uses background tints, not dividers:
  //   • top bar + sidebar share ``bg-muted/40`` (one continuous chrome
  //     surface wrapping the top-left of the window)
  //   • main pane stays on ``bg-background`` (lighter content area)
  //   • selected session row inside the sidebar bumps to ``bg-muted/70``
  //     so the highlight still pops against the new sidebar fill
  // Picked /40 because it's the lowest opacity that registers as a
  // visible step away from ``bg-background`` in both light and dark
  // themes while still letting the /70 active-row highlight stand out.
  return (
    <div className="flex h-screen min-h-0 w-full flex-col bg-background text-foreground">
      <UnifiedTopBar
        onGoHome={onGoHome}
        activeTitle={activeTitle}
        messagesWidth={messagesWidth}
        onMessagesWidthChange={onWidthChange}
        onOpenSettings={openSettings}
        leftInset={topBarLeftInset}
        heightPx={topBarHeightPx}
        className={topBarClassName}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <aside className="flex min-h-0 w-72 shrink-0 flex-col bg-muted/40">
          <SessionsRail
            sessions={sessions.sessions}
            activeId={sessions.activeId}
            ready={sessions.ready}
            query={query}
            onQuery={setQuery}
            onOpen={(id) => void onOpenSession(id)}
            onRename={(id, title) => void sessions.rename(id, title)}
            onDelete={(id) => void sessions.remove(id)}
            onNewChat={() => void onNewChat()}
            onOpenCronSession={onOpenCronSession}
            onRefresh={() => void sessions.refresh()}
          />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified top bar — spans the full window width above sidebar + main
// ---------------------------------------------------------------------------

interface UnifiedTopBarProps {
  /** Optional — when present, renders a Home button on the left. */
  onGoHome?: () => void;
  /** Active session title for the centre slot. Empty when no chat is selected. */
  activeTitle: string;
  /** Width preset for the messages column. */
  messagesWidth: MessagesMaxWidth;
  onMessagesWidthChange: (next: MessagesMaxWidth) => void;
  onOpenSettings: () => void;
  /** Reserve on the left edge so OS chrome (mac traffic lights) clears. */
  leftInset?: number;
  /** Row height in px. Default 24 (compact). Desktop passes 44. */
  heightPx?: number;
  /** Extra className (desktop passes `app-drag-region`). */
  className?: string;
}

/**
 * Single chrome strip across the whole window. Three slots:
 *
 *   - left:   traffic-light reserve (transparent, drag region) + Home button
 *   - centre: active session title (absolute-positioned, drag through)
 *   - right:  width toggle + Settings gear
 *
 * Replaces the previous split where the sidebar and main pane each had
 * their own header — the new flat row reads as one continuous OS-chrome
 * line and lines up with the macOS traffic-light cluster on the left.
 */
function UnifiedTopBar({
  onGoHome,
  activeTitle,
  messagesWidth,
  onMessagesWidthChange,
  onOpenSettings,
  leftInset = 0,
  heightPx = 24,
  className,
}: UnifiedTopBarProps) {
  const { t } = useT();
  return (
    <header
      className={cn(
        // Background matches the sidebar so the two read as one
        // continuous chrome surface; no border — the contrast against
        // ``bg-background`` in the body carries the boundary.
        "relative flex shrink-0 items-center gap-1 bg-muted/40 pr-2",
        className,
      )}
      style={{
        height: heightPx,
        paddingLeft: Math.max(leftInset, 12),
      }}
    >
      {/* Left cluster: Home button (when provided). The traffic-light
          reserve is provided by ``paddingLeft`` above. */}
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

      <div className="flex-1" />

      {/* Centre: active session title. Absolutely positioned so it
          stays mid-row regardless of how wide the surrounding clusters
          grow. ``pointer-events-none`` on the wrapper lets window
          dragging pass through; the title itself re-enables events
          for its tooltip. */}
      {activeTitle && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center"
          style={{ height: heightPx }}
        >
          <span
            className="pointer-events-auto max-w-[60%] truncate text-[12px] font-medium text-foreground"
            title={activeTitle}
          >
            {activeTitle}
          </span>
        </div>
      )}

      {/* Right cluster: width toggle + Settings gear. */}
      <div className="app-no-drag flex items-center gap-1">
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
      </div>
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
  /** Create a fresh session (button next to the search input). */
  onNewChat: () => void;
  onOpenCronSession: (sessionId: string) => void;
  /**
   * Re-fetch the session index. Fires once on mount so multi-channel
   * rows authored elsewhere (gateway / CLI / cron) appear without
   * waiting for the next storage-watch broadcast.
   */
  onRefresh?: () => void | Promise<void>;
}

/**
 * Two-section sidebar (Cursor/VSCode-style): a "Chats" group with the
 * existing recency-bucketed sessions on top, a "Scheduled tasks" group
 * with cron jobs + runs below. Both sections are collapsible
 * independently; the search box at the top filters chat titles only
 * (cron rows are short-list and ordered by run time, no point
 * search-filtering them in the same control).
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
  onNewChat,
  onOpenCronSession,
  onRefresh,
}: SessionsRailProps) {
  const { t } = useT();

  // Refresh the index once when the rail mounts so multi-channel rows
  // authored elsewhere (gateway / CLI / cron) appear without waiting
  // for the next storage-watch broadcast. The rail is mounted for the
  // lifetime of the chat view, so this fires once per view-open.
  useEffect(() => {
    if (onRefresh) void onRefresh();
    // We only want to refresh on mount — re-running on every onRefresh
    // identity change would chatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Sessions split by originating channel. Each channel becomes its own
   * top-level section; date-bucket grouping (Today / Yesterday / …) lives
   * inside each section. Local sessions (``browser-extension``) keep the
   * existing "Chats" label so single-channel users see the same UI they
   * always had; remote channels render as additional sections labelled
   * with the channel name.
   */
  const channelSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Cron-source sessions live in the "Scheduled tasks" group only;
    // upstream Hermes names them ``cron_{job_id}_{stamp}``. Filter them
    // out of the chat list so the same conversation doesn't surface
    // in both groups.
    const live = sessions.filter(
      (s) => !s.archived && !s.id.startsWith("cron_"),
    );
    const matching = q
      ? live.filter((s) =>
          (s.title || t("chat.untitled")).toLowerCase().includes(q),
        )
      : live;

    const bySource = new Map<string, SessionMeta[]>();
    for (const s of matching) {
      const src = s.source ?? "browser-extension";
      const arr = bySource.get(src) ?? [];
      arr.push(s);
      bySource.set(src, arr);
    }

    // Section ordering: local first (it's the user's home), then remote
    // channels by count desc — frequently-used remote surfaces (e.g. a
    // busy Feishu chat) bubble up.
    const localSources = ["browser-extension", "desktop"];
    const sections: {
      source: string;
      label: string;
      items: SessionMeta[];
      isLocal: boolean;
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
      sections.push({ source: src, label: labelFor(src), items, isLocal: true });
    }
    const remote = Array.from(bySource.entries())
      .filter(([src]) => !localSources.includes(src))
      .sort((a, b) => b[1].length - a[1].length);
    for (const [src, items] of remote) {
      sections.push({ source: src, label: labelFor(src), items, isLocal: false });
    }
    return sections;
  }, [sessions, query, t]);

  // Total matching count — for the "no matches" empty state when query
  // filters everything out (regardless of which channel they came from).
  const totalMatching = useMemo(
    () => channelSections.reduce((s, sec) => s + sec.items.length, 0),
    [channelSections],
  );

  // Per-section collapse state. Keyed by SessionDB source so adding a
  // new channel surface doesn't clobber the user's collapse choices for
  // the existing ones. ``scheduled`` is the only fixed key.
  const [topCollapsed, setTopCollapsed] = useState<Record<string, boolean>>({
    scheduled: false,
  });
  const toggleTop = (k: string) =>
    setTopCollapsed((p) => ({ ...p, [k]: !p[k] }));

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 px-3 py-2">
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
        {/* New-chat button — h-6 w-6 click target with centred icon so
            the hover background stays visually balanced around the
            glyph (right-aligning the icon inside the box made the
            hover fill look "歪/skewed" — extended too far left of the
            icon). Visual rail alignment is achieved by giving the
            section count badges below an identical w-6 slot with the
            number right-aligned inside it — both items share the same
            right-edge column. ``Plus`` reads as "new" universally;
            the previous ``SquarePen`` was unclear. */}
        <button
          type="button"
          onClick={onNewChat}
          className="ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("chat.newChat")}
          aria-label={t("chat.newChat")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/*
        Resizable section list: each TopSection sits in a flex item
        with an adjustable weight; 4px drag handles between adjacent
        expanded sections let the user redistribute heights VSCode-
        style. Collapsed sections shrink to their header and don't
        participate in the resize pool. No top border on the container:
        the search row above and this list share the sidebar's
        ``bg-muted/40`` fill, and the search row's vertical padding
        alone is enough breathing space.
      */}
      {!ready ? (
        <div className="px-3 py-3 text-[11px] text-muted-foreground">
          {t("chat.loadingSessions")}
        </div>
      ) : (
        <ResizableSectionList
          items={(() => {
            const items: ResizableItem[] = [];
            if (totalMatching === 0) {
              // Single placeholder section — the local channel header
              // with an empty body so the user has a visible anchor.
              const localName = (() => {
                const d = resolveChannel("browser-extension");
                const tr = t(d.labelKey as MessageKey);
                return tr === d.labelKey ? d.fallbackLabel : tr;
              })();
              items.push({
                id: "browser-extension",
                collapsed: !!topCollapsed["browser-extension"],
                render: () => (
                  <TopSection
                    label={t("sidepanel.sessions.group.channelChats", {
                      name: localName,
                    })}
                    count={0}
                    collapsed={!!topCollapsed["browser-extension"]}
                    onToggle={() => toggleTop("browser-extension")}
                    variant="rail"
                    flex
                  >
                    <p className="px-3 py-3 text-[11px] text-muted-foreground">
                      {query ? t("chat.noMatches") : t("chat.noSessions")}
                    </p>
                  </TopSection>
                ),
              });
            } else {
              for (const sec of channelSections) {
                const dateGroups = groupByRecency(sec.items, t);
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
                        {dateGroups.map((g) =>
                          g.items.length === 0 ? null : (
                            <div key={g.key} className="flex flex-col">
                              <p className="px-3 pb-0.5 pt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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
                    </TopSection>
                  ),
                });
              }
            }
            items.push({
              id: "scheduled",
              collapsed: !!topCollapsed.scheduled,
              render: () => (
                <ScheduledSection
                  open={!topCollapsed.scheduled}
                  collapsed={!!topCollapsed.scheduled}
                  onToggle={() => toggleTop("scheduled")}
                  activeId={activeId}
                  onOpenCronSession={onOpenCronSession}
                  variant="rail"
                  flex
                />
              ),
            });
            return items;
          })()}
        />
      )}
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
        // Hover only changes the background tint; text colour stays
        // ``text-muted-foreground`` so unselected rows don't appear to
        // "bold up" when hovered. The active row keeps full-strength
        // ``text-foreground`` as the canonical "this is the selected
        // chat" cue.
        "group flex items-center gap-2 px-3 py-1.5 text-left transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60",
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
      {/* Relative-time badge — fixed 24px-wide right-edge slot so it
          shares a visual column with the "+ new chat" button and the
          section count badges. NO ``h-6`` here so the slot's height
          tracks the row's natural content; otherwise the row would
          be 24px tall when the time badge is showing and shrink to
          the action cluster's height on hover, producing a visible
          row-height jitter every time the cursor enters/leaves. */}
      <span className="inline-flex w-6 shrink-0 items-center justify-center text-[9px] tabular-nums text-muted-foreground/70 group-hover:hidden">
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

