/**
 * Full-screen chat surface — a thin top bar above a two-pane body
 * (sessions rail on the left, chat on the right). The chat itself is
 * `<ChatSurface variant="fullscreen">` so it skips its own TabBar
 * (this rail handles session switching) and fills its parent vertically.
 *
 * Both panes share session state through the PlatformAdapter's storage
 * watch — the sessions rail and the ChatSurface each instantiate their
 * own `useSessions`, but writes propagate via the underlying storage
 * change-broadcast mechanism.
 *
 * Extension uses this as the standalone ``tabs/chat.html`` page; desktop
 * uses it as the chat view inside the main BrowserWindow.
 */

import { Home, Plus, Settings, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import {
  getHermesCronJobs,
  parseCronSessionJobId,
  useCronSessions,
  useSessions,
  type ChatEngineClient,
  type SessionMeta,
} from "@hermes-x/core";
import { useT, type TranslateFn } from "@hermes-x/i18n";
import { getPlatform, type StorageChangeMap } from "@hermes-x/platform";
import { useResolvedTheme } from "../theme";
import { cn } from "../primitives";
import type { ChatSurfaceCapabilities } from "./internal/capabilities";
import type { MessagesMaxWidth } from "./internal/types";
import { ActivityBar, type ActivityViewId } from "./ActivityBar";
import { SessionsListView } from "./SessionsListView";
import {
  SessionTitleProvider,
  useSessionTitle,
} from "./useSessionTitle";
import ChatSurface from "./ChatSurface";

const MESSAGES_WIDTH_KEY = "settings.chat.messagesWidth";
const DEFAULT_MESSAGES_WIDTH: MessagesMaxWidth = "comfortable";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";
const DEFAULT_SIDEBAR_VIEW: ActivityViewId = "chats";

function isSidebarView(v: unknown): v is ActivityViewId {
  return v === "chats" || v === "scheduled";
}

/**
 * Bucket label used for cron sessions whose id doesn't parse into a
 * recognizable ``cron_{jobId}_{ts}`` form. Realistically empty in
 * normal operation, but kept as an explicit constant so the orphan
 * section is grouped consistently rather than each row turning into
 * its own one-element section.
 */
const CRON_ORPHAN_SOURCE = "__cron_orphan__";

/** Format a Hermes cron-run trigger timestamp into the row title. */
function formatRunTitle(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  capabilities?: ChatSurfaceCapabilities;
  /** Slots forwarded to ChatSurface (BridgeStatusBar / NavigateOpenPolicyToggle / empty-state). */
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

export default function FullScreenChatView(props: FullScreenChatViewProps) {
  // The provider owns the top-bar title-override store. Any descendant
  // (chat surface, future plugin panels, etc.) can call
  // ``useSetSessionTitle`` to hot-update the bar without prop-drilling.
  return (
    <SessionTitleProvider>
      <FullScreenChatViewInner {...props} />
    </SessionTitleProvider>
  );
}

function FullScreenChatViewInner({
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
  const { t } = useT();
  const sessions = useSessions();
  const cronSessions = useCronSessions();
  const [query, setQuery] = useState("");
  const [messagesWidth, setMessagesWidth] = useState<MessagesMaxWidth>(
    DEFAULT_MESSAGES_WIDTH,
  );
  const [sidebarView, setSidebarView] =
    useState<ActivityViewId>(DEFAULT_SIDEBAR_VIEW);

  // Chats data: drop archived rows AND any cron-emitted session. We
  // also filter by id prefix even though core's loadIndex already
  // passes ``excludeSources: ["cron"]``: rows with an empty/missing
  // ``source`` field but the canonical ``cron_{jobId}_{stamp}`` id can
  // still slip through (legacy data, gateway misroutes, partial flushes),
  // and a single leaked cron run polluting "Local chats" is exactly the
  // bug we're avoiding. Cron runs are always reachable via the
  // Scheduled-tasks activity view.
  const chatSessions = useMemo(
    () =>
      sessions.sessions.filter(
        (s) => !s.archived && !s.id.startsWith("cron_"),
      ),
    [sessions.sessions],
  );

  // Cron job id → display name. Populated once on mount from the cron
  // jobs API; used to label each Scheduled-view section with the job's
  // human-readable name instead of the raw id. Jobs that have run rows
  // in SessionDB but no live config still surface (via the fallback in
  // ``cronSectionLabelFor`` below), so historical runs stay reachable
  // even after a job is removed.
  const [cronJobNames, setCronJobNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await getHermesCronJobs();
      if (cancelled || !r.ok) return;
      const m = new Map<string, string>();
      for (const j of r.jobs) m.set(j.id, j.name || j.id);
      setCronJobNames(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Scheduled-tasks data: cron sessions come from a separate hook
  // (`useCronSessions` → ``listHermesSessions({ source: "cron" })``)
  // because the main session index hides them. Convert each
  // `HermesSession` to a `SessionMeta` keyed by JOB ID (not by the
  // generic ``source: "cron"``) so the unified list view groups runs
  // under their parent job — the rail's channel sectioning then doubles
  // as job sectioning. The row title is the trigger timestamp instead
  // of the (empty) session title, since each row represents one run.
  const cronSessionsAsMeta = useMemo<SessionMeta[]>(
    () =>
      cronSessions.sessions.map((s) => {
        const jobId = parseCronSessionJobId(s.id) ?? CRON_ORPHAN_SOURCE;
        const startedMs = (s.started_at ?? 0) * 1000;
        const updatedMs = (s.last_active ?? s.started_at ?? 0) * 1000;
        return {
          id: s.id,
          title: formatRunTitle(startedMs),
          createdAt: startedMs,
          updatedAt: updatedMs,
          messageCount: s.message_count ?? 0,
          source: jobId,
        };
      }),
    [cronSessions.sessions],
  );

  const cronSectionLabelFor = useCallback(
    (src: string): string => {
      if (src === CRON_ORPHAN_SOURCE) {
        return t("sidepanel.sessions.group.scheduled");
      }
      return cronJobNames.get(src) ?? src;
    },
    [cronJobNames, t],
  );

  // Active chat-session title — used as one of the top-bar placeholder
  // sources. Cron runs are resolved separately below because they need
  // job-name enrichment that doesn't fit the SessionMeta.title field
  // (which carries the trigger timestamp).
  const activeChatTitle = useMemo<string>(() => {
    if (!sessions.activeId) return "";
    const found = chatSessions.find((s) => s.id === sessions.activeId);
    return found?.title?.trim() || "";
  }, [sessions.activeId, chatSessions]);

  // Cron-run top-bar title: ``{jobName} · {triggerTime}``. Falls back to
  // just the trigger time when the job name isn't known (orphan run or
  // jobs API hasn't responded yet). Returns null when the active id
  // isn't a cron session — lets the placeholder chain skip past.
  const activeCronTitle = useMemo<string | null>(() => {
    if (!sessions.activeId) return null;
    const meta = cronSessionsAsMeta.find((s) => s.id === sessions.activeId);
    if (!meta) return null;
    const jobId = meta.source;
    const jobName =
      jobId && jobId !== CRON_ORPHAN_SOURCE
        ? cronJobNames.get(jobId)
        : undefined;
    return jobName ? `${jobName} · ${meta.title}` : meta.title;
  }, [sessions.activeId, cronSessionsAsMeta, cronJobNames]);

  // External title override pushed via ``useSetSessionTitle`` from
  // anywhere in the subtree. Highest-priority slot in the placeholder
  // chain so downstream features can take over the bar when they need
  // to (e.g. a running task surfacing progress).
  const externalTitleOverride = useSessionTitle();

  // Final placeholder. Priority: external override > cron job · time >
  // active chat title > product wordmark.
  const topBarPlaceholder =
    externalTitleOverride ||
    activeCronTitle ||
    activeChatTitle ||
    "Hermes X";

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

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get(SIDEBAR_VIEW_KEY).then((r) => {
      if (cancelled) return;
      const v = r[SIDEBAR_VIEW_KEY];
      if (isSidebarView(v)) setSidebarView(v);
    });
    const unsub = storage.watch([SIDEBAR_VIEW_KEY], (changes: StorageChangeMap) => {
      const ch = changes[SIDEBAR_VIEW_KEY];
      if (ch && isSidebarView(ch.newValue)) setSidebarView(ch.newValue);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  function onSidebarViewChange(next: ActivityViewId) {
    setSidebarView(next);
    void getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: next });
  }

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
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={topBarPlaceholder}
        onNewChat={sidebarView === "chats" ? () => void onNewChat() : undefined}
        messagesWidth={messagesWidth}
        onMessagesWidthChange={onWidthChange}
        onOpenSettings={openSettings}
        leftInset={topBarLeftInset}
        heightPx={topBarHeightPx}
        className={topBarClassName}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <ActivityBar
          active={sidebarView}
          onSelect={onSidebarViewChange}
        />
        <aside className="flex min-h-0 w-72 shrink-0 flex-col bg-muted/40">
          {sidebarView === "chats" ? (
            <SessionsListView
              sessions={chatSessions}
              activeId={sessions.activeId}
              ready={sessions.ready}
              query={query}
              onOpen={(id) => void onOpenSession(id)}
              onRename={(id, title) => void sessions.rename(id, title)}
              onDelete={(id) => void sessions.remove(id)}
              onRefresh={() => void sessions.refresh()}
            />
          ) : (
            <SessionsListView
              sessions={cronSessionsAsMeta}
              activeId={sessions.activeId}
              ready={cronSessions.ready}
              query={query}
              onOpen={(id) => void onOpenSession(id)}
              onRename={(id, title) => void sessions.rename(id, title)}
              onDelete={(id) => void sessions.remove(id)}
              onRefresh={() => void cronSessions.refresh()}
              emptyLabel={t("sidepanel.sessions.scheduled.empty")}
              sectionLabelFor={cronSectionLabelFor}
            />
          )}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChatSurface
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
  /** Live search query bound to the centre search input. */
  query: string;
  onQueryChange: (next: string) => void;
  /**
   * Placeholder text shown inside the search pill when ``query`` is
   * empty. Host passes the active session's title here when something
   * is selected, otherwise the product wordmark — so the centre slot
   * doubles as a "you are here" indicator without an extra label row.
   */
  searchPlaceholder: string;
  /**
   * Optional new-chat handler. When provided, a `+` button renders in
   * the right cluster — passed only on the Chats view so the affordance
   * stays scoped to where it actually makes sense.
   */
  onNewChat?: () => void;
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
 *   - centre: command-center style search input (VSCode reference)
 *   - right:  new-chat (Chats view only) + width toggle + Settings gear
 *
 * The centre input is the single search affordance for both activity
 * views — the sidebar no longer owns its own search row.
 */
function UnifiedTopBar({
  onGoHome,
  query,
  onQueryChange,
  searchPlaceholder,
  onNewChat,
  messagesWidth,
  onMessagesWidthChange,
  onOpenSettings,
  leftInset = 0,
  heightPx = 24,
  className,
}: UnifiedTopBarProps) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  // ``paletteOpen`` tracks the focused state of the pill. Today it just
  // toggles a placeholder dropdown; the panel is wired up so a future
  // pass can drop a Cursor/VSCode-style command-palette body in without
  // touching the surrounding layout or focus-management plumbing.
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Blur the search input when the user mouses down on any part of the
  // top bar that isn't the pill itself — drag region, side spacer, even
  // the other top-bar buttons. Electron's ``-webkit-app-region: drag``
  // areas intercept mousedown for window dragging, so a click on the
  // empty chrome doesn't naturally blur the focused input the way it
  // would in a plain browser; we have to force it here.
  const onHeaderMouseDown = (e: ReactMouseEvent<HTMLElement>) => {
    if (pillRef.current?.contains(e.target as Node)) return;
    inputRef.current?.blur();
  };

  return (
    <header
      onMouseDown={onHeaderMouseDown}
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

      {/* Centre: command-center search. Absolutely positioned + width-
          capped so it stays mid-row regardless of how wide the side
          clusters grow. The outer wrapper is ``pointer-events-none`` so
          window-drag still works in the empty gaps; the input pill itself
          re-enables events via ``pointer-events-auto`` + ``app-no-drag``. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center px-2"
        style={{ height: heightPx }}
      >
        <div
          ref={pillRef}
          onClick={() => inputRef.current?.focus()}
          className="app-no-drag pointer-events-auto relative flex h-6 w-full max-w-md cursor-pointer items-center gap-1.5 rounded-md border border-border/40 bg-background/60 px-2 focus-within:border-foreground/30"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => setPaletteOpen(true)}
            onBlur={() => setPaletteOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") inputRef.current?.blur();
            }}
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-center text-xs outline-none placeholder:text-muted-foreground/70 focus:cursor-text focus:text-left"
          />
          {query && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onQueryChange("")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("chat.searchClear")}
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {paletteOpen && (
            // mousedown.preventDefault keeps the input focused when the
            // user clicks anywhere inside the panel (so future row-click
            // handlers don't race the blur). Positioning: anchored under
            // the pill, same width — VSCode command-center geometry.
            <div
              onMouseDown={(e) => e.preventDefault()}
              role="listbox"
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 cursor-default overflow-y-auto rounded-md border border-border/40 bg-popover text-popover-foreground"
            >
              <div className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                Search & commands coming soon
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right cluster: new-chat (chats view) + width toggle + settings. */}
      <div className="app-no-drag flex items-center gap-1">
        {onNewChat && (
          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("chat.newChat")}
            title={t("chat.newChat")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
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


