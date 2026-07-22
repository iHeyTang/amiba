/**
 * Full-screen chat surface — a thin top bar above a two-pane body
 * (the single-level sidebar on the left, the main pane on the right).
 *
 * The sidebar (`<Sidebar>`) is one column with three regions: a fixed top
 * (new-chat / search / built-in + extension nav rows), the conversation-history
 * list, and a settings row pinned at the bottom. It replaces the old icon
 * `ActivityBar` rail + the `w-72` session-list aside.
 *
 * The main pane renders by `sidebarView`: the chat surface ("chats"), the
 * scheduled-runs page ("scheduled"), or an extension webview for
 * extension-contributed main panels. (Skills / Tokens / Tools live in
 * the Settings window as settings panes.)
 *
 * Extension uses this as the standalone ``tabs/chat.html`` page; desktop uses
 * it as the chat view inside the main BrowserWindow.
 */

import { Home } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useSessions,
  type ChatEngineClient,
} from "@amiba/core";
import type { TriggerProvider } from "./composer/providers/types";
import { useT } from "@amiba/i18n";
import { getPlatform, type StorageChangeMap } from "@amiba/platform";
import { useResolvedTheme } from "../theme";
import { cn } from "../primitives";
import type { ChatSurfaceCapabilities } from "./internal/capabilities";
import type { MessagesMaxWidth } from "./internal/types";
import { Sidebar, type ActivityViewId } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { useCommandPalette } from "./useCommandPalette";
import { ScheduledRunsPage } from "./ScheduledRunsPage";
import { SessionsListView } from "./SessionsListView";
import { useScheduledRuns } from "./internal/useScheduledRuns";
import {
  SessionTitleProvider,
  useSessionTitle,
} from "./useSessionTitle";
import ChatSurface from "./ChatSurface";
import {
  ExtensionWebView,
  useExtensionMains,
} from "@amiba/extension-host/renderer";

const MESSAGES_WIDTH_KEY = "settings.chat.messagesWidth";
const DEFAULT_MESSAGES_WIDTH: MessagesMaxWidth = "comfortable";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";
const DEFAULT_SIDEBAR_VIEW: ActivityViewId = "chats";

const SIDEBAR_WIDTH_KEY = "settings.chat.sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH = 240; // matches the `w-60` fallback
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 420;

function clampSidebarWidth(v: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(v)));
}

function isSidebarWidth(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isSidebarView(v: unknown): v is ActivityViewId {
  return typeof v === "string" && v.length > 0;
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
  /**
   * TabBar gear / settings row → open Settings. The optional ``tab``
   * argument names the Settings sub-pane to land on (matches the
   * SettingsView hash routing); when omitted, the host opens the
   * user's last-active pane.
   */
  openSettings: (tab?: string) => void;
  /** AgentDestinationChip — open URL in user's primary browser. */
  openAgentDestination: (url: string) => void | Promise<void>;
  /**
   * Optional top-bar logo / Home click → navigate back to Home. When
   * omitted, no Home button renders (desktop omits it; browser-ext passes it).
   */
  onGoHome?: () => void;
  /**
   * Pixel reserve on the left edge of the top header so OS chrome
   * (macOS traffic lights when running inside Electron with a hidden
   * native title bar) doesn't visually collide with the content. Default
   * 0; desktop passes ~96 on mac.
   */
  topBarLeftInset?: number;
  /**
   * Top bar row height in pixels. Defaults to 24 (compact, matches
   * extension/web layouts). Desktop overrides to 32 so the centred title
   * lands on the macOS traffic-light baseline.
   */
  topBarHeightPx?: number;
  /**
   * Extra className applied to the top header. Desktop passes
   * `app-drag-region` so the user can drag the window from the header
   * (buttons inside opt out automatically via the global CSS rule).
   */
  topBarClassName?: string;
  /**
   * Host-injected composer mention providers (e.g. desktop's `@file`
   * source). Forwarded verbatim to the inner `<ChatSurface mentionProviders>`.
   */
  mentionProviders?: TriggerProvider[];
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
  mentionProviders,
}: FullScreenChatViewProps) {
  useResolvedTheme();
  const { t } = useT();
  const sessions = useSessions();
  const scheduled = useScheduledRuns();
  const palette = useCommandPalette();
  const [messagesWidth, setMessagesWidth] = useState<MessagesMaxWidth>(
    DEFAULT_MESSAGES_WIDTH,
  );
  const [sidebarView, setSidebarView] =
    useState<ActivityViewId>(DEFAULT_SIDEBAR_VIEW);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  // Chats data: drop archived rows AND any cron-emitted session. We also
  // filter by id prefix even though core's loadIndex already passes
  // ``excludeSources: ["cron"]``: rows with an empty/missing ``source`` field
  // but the canonical ``cron_{jobId}_{stamp}`` id can still slip through
  // (legacy data, gateway misroutes, partial flushes). Cron runs are always
  // reachable via the Scheduled page.
  const chatSessions = useMemo(
    () =>
      sessions.sessions.filter(
        (s) => !s.archived && !s.id.startsWith("cron_"),
      ),
    [sessions.sessions],
  );

  // Active chat-session title — one of the top-bar placeholder sources.
  const activeChatTitle = useMemo<string>(() => {
    if (!sessions.activeId) return "";
    const found = chatSessions.find((s) => s.id === sessions.activeId);
    return found?.title?.trim() || "";
  }, [sessions.activeId, chatSessions]);

  // External title override pushed via ``useSetSessionTitle`` from anywhere in
  // the subtree. Highest-priority slot in the placeholder chain.
  const externalTitleOverride = useSessionTitle();

  // Final top-bar title. Priority: external override > cron job · time >
  // active chat title > product wordmark.
  const topBarPlaceholder =
    externalTitleOverride ||
    (sessions.activeId ? scheduled.activeRunTitle(sessions.activeId) : null) ||
    activeChatTitle ||
    "Amiba";

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

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get(SIDEBAR_WIDTH_KEY).then((r) => {
      if (cancelled) return;
      const v = r[SIDEBAR_WIDTH_KEY];
      if (isSidebarWidth(v)) setSidebarWidth(clampSidebarWidth(v));
    });
    const unsub = storage.watch([SIDEBAR_WIDTH_KEY], (changes: StorageChangeMap) => {
      const ch = changes[SIDEBAR_WIDTH_KEY];
      if (ch && isSidebarWidth(ch.newValue))
        setSidebarWidth(clampSidebarWidth(ch.newValue));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Sidebar resize: pointer-drag on the divider between the sidebar and the
  // main pane. Width applies live during the drag; persisted once on release.
  const onSidebarResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = sidebarWidthRef.current;
      let width = startWidth;
      const onMove = (ev: PointerEvent) => {
        width = clampSidebarWidth(startWidth + (ev.clientX - startX));
        setSidebarWidth(width);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        void getPlatform().storage.set({ [SIDEBAR_WIDTH_KEY]: width });
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [],
  );

  const extensionMains = useExtensionMains();

  const onSidebarViewChange = useCallback((next: ActivityViewId) => {
    setSidebarView(next);
    void getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: next });
  }, []);

  // New-chat row: mint a session AND land the main pane on the chat surface
  // (the row is reachable from any view, not just Chats).
  const onNewChatAndShow = useCallback(async () => {
    if (!sessions.ready) return;
    await sessions.createNew();
    onSidebarViewChange("chats");
  }, [sessions, onSidebarViewChange]);

  // Conversation-list row click: toggle. Picking the active row deselects it
  // (lands on the home / empty-state surface); picking a different row opens +
  // activates it and brings the chat surface forward.
  const onOpenSession = useCallback(
    async (id: string) => {
      if (!sessions.ready) return;
      if (id === sessions.activeId) {
        await sessions.deselect();
        return;
      }
      await sessions.openTab(id);
      onSidebarViewChange("chats");
    },
    [sessions, onSidebarViewChange],
  );

  // Scheduled-page run click: activate the run as the active session and
  // STAY on the scheduled page — the run's conversation renders inline in
  // the page's detail pane (the master/detail layout). Clicking the active
  // run again deselects it (mirrors `onOpenSession`), dropping the detail
  // pane back to its placeholder.
  const onOpenRun = useCallback(
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

  // Whether the active session is one of the cron runs — gates whether the
  // scheduled page's detail pane shows the ChatSurface (a run is selected)
  // or its "select a run" placeholder (active session is a chat, or none).
  const activeRunSelected = useMemo(
    () =>
      !!sessions.activeId &&
      scheduled.runs.some((r) => r.id === sessions.activeId),
    [sessions.activeId, scheduled.runs],
  );

  // Layout: a single thin top bar spans the full window width (mac traffic
  // lights + drag region + centered active title), with the body row
  // (sidebar | main) below it. The top bar + sidebar share ``bg-muted/40`` so
  // they read as one continuous chrome surface; the main pane stays on
  // ``bg-background`` (lighter content area).
  return (
    <div className="flex h-screen min-h-0 w-full flex-col bg-background text-foreground">
      <SlimTopBar
        onGoHome={onGoHome}
        title={topBarPlaceholder}
        leftInset={topBarLeftInset}
        heightPx={topBarHeightPx}
        className={topBarClassName}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar
          activeView={sidebarView}
          onSelectView={onSidebarViewChange}
          onNewChat={() => void onNewChatAndShow()}
          extensionItems={extensionMains}
          onOpenCommandPalette={() => palette.setOpen(true)}
          sessions={chatSessions}
          activeSessionId={sessions.activeId}
          sessionsReady={sessions.ready}
          onOpenSession={(id) => void onOpenSession(id)}
          onRenameSession={(id, title) => void sessions.rename(id, title)}
          onDeleteSession={(id) => void sessions.remove(id)}
          onRefreshSessions={() => void sessions.refresh()}
          onOpenSettings={() => openSettings()}
          historyContent={
            sidebarView === "scheduled" ? (
              <SessionsListView
                sessions={scheduled.runs}
                activeId={sessions.activeId}
                ready={scheduled.ready}
                query=""
                onOpen={(id) => void onOpenRun(id)}
                onRename={() => {}}
                onDelete={() => {}}
                onRefresh={scheduled.refresh}
                emptyLabel={t("sidepanel.sessions.scheduled.empty")}
                sectionLabelFor={scheduled.labelFor}
                sectionActionsFor={scheduled.actionsFor}
              />
            ) : undefined
          }
          widthPx={sidebarWidth}
        />
        {/* Resize divider: invisible 4px hit area straddling the sidebar
            edge; shows an accent line on hover / while dragging. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("chat.resizeSidebar")}
          data-testid="sidebar-resize-handle"
          onPointerDown={onSidebarResizeStart}
          className="group relative -ml-1 w-1 shrink-0 cursor-col-resize touch-none"
        >
          <div className="absolute inset-y-0 right-0 w-px bg-transparent transition-colors group-hover:bg-border group-active:bg-primary/30" />
        </div>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {sidebarView === "scheduled" ? (
            <ScheduledRunsPage
              query=""
              activeId={sessions.activeId}
              onOpenRun={(id) => void onOpenRun(id)}
              showList={false}
              detail={
                activeRunSelected ? (
                  <ChatSurface
                    variant="fullscreen"
                    messagesMaxWidth={messagesWidth}
                    client={client}
                    capabilities={capabilities}
                    slots={slots}
                    openSettings={openSettings}
                    openAgentDestination={openAgentDestination}
                    mentionProviders={mentionProviders}
                  />
                ) : undefined
              }
            />
          ) : sidebarView === "chats" ? (
            <ChatSurface
              variant="fullscreen"
              messagesMaxWidth={messagesWidth}
              client={client}
              capabilities={capabilities}
              slots={slots}
              openSettings={openSettings}
              openAgentDestination={openAgentDestination}
              mentionProviders={mentionProviders}
            />
          ) : (() => {
            // Extension-contributed main panel. The sidebarView id IS the extensionId.
            const contrib = extensionMains.find((m) => m.extensionId === sidebarView);
            if (contrib) {
              return <ExtensionWebView src={contrib.viewUrl} className="h-full w-full" />;
            }
            return null;
          })()}
        </main>
      </div>
      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
        sessions={chatSessions}
        onOpenSession={(id) => void onOpenSession(id)}
        onNewChat={() => void onNewChatAndShow()}
        onOpenSettings={() => openSettings()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slim top bar — a thin chrome strip across the full window width
// ---------------------------------------------------------------------------

interface SlimTopBarProps {
  /** Optional — when present, renders a Home button on the left. */
  onGoHome?: () => void;
  /** Centered active conversation / page title. */
  title: string;
  /** Reserve on the left edge so OS chrome (mac traffic lights) clears. */
  leftInset?: number;
  /** Row height in px. Default 24 (compact). Desktop passes 32. */
  heightPx?: number;
  /** Extra className (desktop passes `app-drag-region`). */
  className?: string;
}

/**
 * Thin chrome strip across the window: mac traffic-light reserve + window-drag
 * region + a centered active-title readout. Search / new-chat / settings now
 * live in the sidebar, so this bar carries no actions except an optional Home
 * button (browser-extension passes `onGoHome`; desktop omits it).
 */
function SlimTopBar({
  onGoHome,
  title,
  leftInset = 0,
  heightPx = 24,
  className,
}: SlimTopBarProps) {
  const { t } = useT();
  return (
    <header
      className={cn(
        // Background matches the sidebar so the two read as one continuous
        // chrome surface; no border — the contrast against ``bg-background``
        // in the body carries the boundary.
        "relative flex shrink-0 items-center bg-muted/40 pr-2",
        className,
      )}
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
      {/* Centre: active title. ``pointer-events-none`` so window-drag still
          works across the whole bar. */}
      <div className="pointer-events-none absolute inset-x-0 flex h-full items-center justify-center">
        <span className="truncate px-2 text-xs font-medium tracking-tight text-foreground/65">
          {title}
        </span>
      </div>
    </header>
  );
}
