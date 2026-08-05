/**
 * Full-screen chat surface — two direct side-by-side panes. Each pane owns
 * its own header so the window chrome reinforces the sidebar/content split
 * instead of placing an unrelated status strip across the whole app.
 *
 * The sidebar (`<Sidebar>`) is one column with three regions: a fixed top
 * (new-chat / search / built-in + extension nav rows), unified conversation
 * history, and a settings row pinned at the bottom. It replaces the old icon
 * `ActivityBar` rail + the `w-72` session-list aside.
 *
 * The main pane renders by `sidebarView`: the chat surface ("chats"), the
 * registered scheduled-tasks page ("scheduled"), or an extension webview for
 * extension-contributed main panels. (Skills / Tokens / Tools live in
 * the Settings window as settings panes.)
 *
 * Extension uses this as the standalone ``tabs/chat.html`` page; desktop uses
 * it as the chat view inside the main BrowserWindow.
 */

import {
  BookOpen,
  Clock,
  Folder,
  Home,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useSessions, type ChatEngineClient } from "@amiba/core";
import type { TriggerProvider } from "./composer/providers/types";
import { useT } from "@amiba/i18n";
import { getPlatform, type StorageChangeMap } from "@amiba/platform";
import { useResolvedTheme } from "../theme";
import { cn } from "../primitives";
import type { ChatSurfaceCapabilities } from "./internal/capabilities";
import type { MessagesMaxWidth } from "./internal/types";
import { Sidebar, type ActivityViewId, type HistoryLayout } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { useCommandPalette } from "./useCommandPalette";
import { ScheduledTasksPage } from "./ScheduledTasksPage";
import { TaskCenterPage } from "./TaskCenterPage";
import { useScheduledRuns } from "./internal/useScheduledRuns";
import { SessionTitleProvider, useSessionTitle } from "./useSessionTitle";
import ChatSurface from "./ChatSurface";
import {
  WorkspacePane,
  WorkspacePaneProvider,
  WorkspacePaneToggle,
} from "./WorkspacePane";
import {
  ExtensionWebView,
  useExtensionMains,
} from "@amiba/extension-host/renderer";

const MESSAGES_WIDTH_KEY = "settings.chat.messagesWidth";
const DEFAULT_MESSAGES_WIDTH: MessagesMaxWidth = "comfortable";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";
const DEFAULT_SIDEBAR_VIEW: ActivityViewId = "chats";

const SIDEBAR_WIDTH_KEY = "settings.chat.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "settings.chat.sidebarCollapsed";
const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 420;

const HISTORY_LAYOUT_KEY = "settings.chat.historyLayout";
const DEFAULT_HISTORY_LAYOUT: HistoryLayout = "timeline";

function clampSidebarWidth(v: number): number {
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(v)),
  );
}

function isSidebarWidth(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isSidebarCollapsed(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isSidebarView(v: unknown): v is ActivityViewId {
  return typeof v === "string" && v.length > 0;
}

function isHistoryLayout(v: unknown): v is HistoryLayout {
  return v === "timeline" || v === "grouped";
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
      onChange: (
        next: import("./internal/capabilities").NavigateOpenPolicy,
      ) => void;
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
   * Pixel reserve on the left edge of the sidebar header so OS chrome
   * (macOS traffic lights when running inside Electron with a hidden
   * native title bar) doesn't visually collide with the content. Default
   * 0; desktop passes ~96 on mac.
   */
  topBarLeftInset?: number;
  /**
   * Pane header row height in pixels. Defaults to 40 for web layouts.
   * Desktop overrides to 48 so the traffic lights and header actions have
   * comfortable, consistent hit areas.
   */
  topBarHeightPx?: number;
  /**
   * Extra className applied to both pane headers. Desktop passes
   * `app-drag-region` so the user can drag the window from either header.
   */
  topBarClassName?: string;
  /**
   * Host-injected composer mention providers (e.g. desktop's `@file`
   * source). Forwarded verbatim to the inner `<ChatSurface mentionProviders>`.
   */
  mentionProviders?: TriggerProvider[];
  /**
   * Restore the last selected sidebar destination on mount. Desktop disables
   * this so every app launch lands on the id-less chat home; other hosts keep
   * the existing persisted-navigation behaviour by default.
   */
  restoreSidebarViewOnMount?: boolean;
}

export default function FullScreenChatView(props: FullScreenChatViewProps) {
  const sessions = useSessions();
  // The provider owns the top-bar title-override store. Any descendant
  // (chat surface, future plugin panels, etc.) can call
  // ``useSetSessionTitle`` to hot-update the bar without prop-drilling.
  return (
    <SessionTitleProvider>
      <WorkspacePaneProvider
        capability={props.capabilities?.workspaceInspector}
        sessionId={sessions.activeId}
      >
        <FullScreenChatViewInner {...props} />
      </WorkspacePaneProvider>
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
  restoreSidebarViewOnMount = true,
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyLayout, setHistoryLayout] = useState<HistoryLayout>(
    DEFAULT_HISTORY_LAYOUT,
  );
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  // Keep unread tracking above ChatSurface so it remains active while the
  // user is looking at Automation, Tasks, or an extension-contributed view.
  // A visible chat is read in place; background completions and failures are
  // persisted in Amiba's local session sidecar. User-initiated aborts are not.
  useEffect(() => {
    const setSessionRunning = (sessionId: string, running: boolean) => {
      setRunningSessionIds((current) => {
        if (current.has(sessionId) === running) return current;
        const next = new Set(current);
        if (running) next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
    };

    const unsubscribeSnapshots = client.onSnapshot((frame) => {
      // A live snapshot recovers a run after the window or tab remounts.
      // Terminal snapshots may be responses to older requests, so stream
      // events remain authoritative for stopping an already-observed run.
      if (frame.kind === "live") setSessionRunning(frame.sessionId, true);
    });
    const unsubscribeEvents = client.onStreamEvent((sessionId, event) => {
      const visibleSessionId = sidebarView === "chats" ? sessions.activeId : "";
      const completedInBackground =
        sessionId !== visibleSessionId &&
        (event.kind === "done" || event.kind === "error");

      if (event.kind === "begin") {
        setSessionRunning(sessionId, true);
      } else if (
        event.kind === "done" ||
        event.kind === "error" ||
        event.kind === "aborted"
      ) {
        // Mark the row unread before removing its running state. Both updates
        // then land in the same render, so the status glyph stays mounted and
        // can transition from a breathing halo to a quiet static dot.
        if (completedInBackground) void sessions.markUnread(sessionId);
        setSessionRunning(sessionId, false);
      }
    });

    return () => {
      unsubscribeSnapshots();
      unsubscribeEvents();
    };
  }, [client, sessions.activeId, sessions.markUnread, sidebarView]);

  // Chats data: drop archived rows AND any cron-emitted session. We also
  // filter by id prefix even though core's loadIndex already passes
  // ``excludeSources: ["cron"]``: rows with an empty/missing ``source`` field
  // but the canonical ``cron_{jobId}_{stamp}`` id can still slip through
  // (legacy data, gateway misroutes, partial flushes). Cron runs are always
  // reachable via the Scheduled page.
  const chatSessions = useMemo(
    () =>
      sessions.sessions.filter((s) => !s.archived && !s.id.startsWith("cron_")),
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

  // The workspace destination owns the title while it is selected. Otherwise
  // the active conversation (including a cron-run output) provides context.
  const topBarPlaceholder =
    sidebarView === "scheduled"
      ? t("options.cron.title")
      : sidebarView === "tasks"
        ? t("tasks.title")
        : externalTitleOverride ||
          (sessions.activeId
            ? scheduled.activeRunTitle(sessions.activeId)
            : null) ||
          activeChatTitle;

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get(MESSAGES_WIDTH_KEY).then((r) => {
      if (cancelled) return;
      const v = r[MESSAGES_WIDTH_KEY];
      if (isMessagesMaxWidth(v)) setMessagesWidth(v);
    });
    const unsub = storage.watch(
      [MESSAGES_WIDTH_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[MESSAGES_WIDTH_KEY];
        if (ch && isMessagesMaxWidth(ch.newValue))
          setMessagesWidth(ch.newValue);
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get(SIDEBAR_COLLAPSED_KEY).then((r) => {
      if (cancelled) return;
      const v = r[SIDEBAR_COLLAPSED_KEY];
      if (isSidebarCollapsed(v)) setSidebarCollapsed(v);
    });
    const unsub = storage.watch(
      [SIDEBAR_COLLAPSED_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[SIDEBAR_COLLAPSED_KEY];
        if (ch && isSidebarCollapsed(ch.newValue))
          setSidebarCollapsed(ch.newValue);
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    if (restoreSidebarViewOnMount) {
      void storage.get(SIDEBAR_VIEW_KEY).then((r) => {
        if (cancelled) return;
        const v = r[SIDEBAR_VIEW_KEY];
        if (isSidebarView(v)) setSidebarView(v);
      });
    }
    const unsub = storage.watch(
      [SIDEBAR_VIEW_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[SIDEBAR_VIEW_KEY];
        if (ch && isSidebarView(ch.newValue)) setSidebarView(ch.newValue);
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [restoreSidebarViewOnMount]);

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    void storage.get(HISTORY_LAYOUT_KEY).then((r) => {
      if (cancelled) return;
      const v = r[HISTORY_LAYOUT_KEY];
      if (isHistoryLayout(v)) setHistoryLayout(v);
    });
    const unsub = storage.watch(
      [HISTORY_LAYOUT_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[HISTORY_LAYOUT_KEY];
        if (ch && isHistoryLayout(ch.newValue)) setHistoryLayout(ch.newValue);
      },
    );
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
    const unsub = storage.watch(
      [SIDEBAR_WIDTH_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[SIDEBAR_WIDTH_KEY];
        if (ch && isSidebarWidth(ch.newValue))
          setSidebarWidth(clampSidebarWidth(ch.newValue));
      },
    );
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

  const onHistoryLayoutChange = useCallback((next: HistoryLayout) => {
    setHistoryLayout(next);
    void getPlatform().storage.set({ [HISTORY_LAYOUT_KEY]: next });
  }, []);

  const onSidebarCollapsedChange = useCallback((next: boolean) => {
    setSidebarCollapsed(next);
    void getPlatform().storage.set({ [SIDEBAR_COLLAPSED_KEY]: next });
  }, []);

  // New-chat row is navigation to the id-less home surface. A real session is
  // minted only when that surface submits its first message.
  const onNewChatAndShow = useCallback(async () => {
    if (!sessions.ready) return;
    await sessions.deselect();
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

  // Scheduled runs live in History, not in the registered-task workspace.
  // Opening one behaves like opening any other conversation output.
  const onOpenRun = useCallback(
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

  const activeMain = extensionMains.find((m) => m.extensionId === sidebarView);
  const contentHeaderIcon =
    sidebarView === "scheduled" ? (
      <Clock className="h-4 w-4" />
    ) : sidebarView === "tasks" ? (
      <ListTodo className="h-4 w-4" />
    ) : sidebarView === "chats" ? (
      <Folder className="h-4 w-4" />
    ) : (
      <BookOpen className="h-4 w-4" />
    );

  // Layout: the sidebar and content region are direct siblings. Inside the
  // content region, chat and workspace preview are independent full-height
  // columns; the preview must not inherit or sit below the chat header.
  return (
    <div className="flex h-screen min-h-0 w-full bg-background text-foreground">
      {!sidebarCollapsed && (
        <>
          <aside
            className="flex min-h-0 shrink-0 flex-col bg-muted/30"
            style={{ width: sidebarWidth }}
          >
            <SidebarHeader
              onGoHome={onGoHome}
              onSearch={() => palette.setOpen(true)}
              onCollapse={() => onSidebarCollapsedChange(true)}
              leftInset={topBarLeftInset}
              heightPx={topBarHeightPx}
              className={topBarClassName}
            />
            <Sidebar
              activeView={sidebarView}
              onSelectView={onSidebarViewChange}
              onNewChat={() => void onNewChatAndShow()}
              extensionItems={extensionMains}
              sessions={chatSessions}
              runningSessionIds={runningSessionIds}
              activeSessionId={sessions.activeId}
              sessionsReady={sessions.ready}
              onOpenSession={(id) => void onOpenSession(id)}
              onRenameSession={(id, title) => void sessions.rename(id, title)}
              onDeleteSession={(id) => void sessions.remove(id)}
              onRefreshSessions={() => void sessions.refresh()}
              scheduledSessions={scheduled.runs}
              scheduledReady={scheduled.ready}
              onOpenScheduledSession={(id) => void onOpenRun(id)}
              onRefreshScheduledSessions={scheduled.refresh}
              scheduledLabelFor={scheduled.labelFor}
              historyLayout={historyLayout}
              onHistoryLayoutChange={onHistoryLayoutChange}
              onOpenTaskCenter={() => onSidebarViewChange("tasks")}
              onOpenSettings={() => openSettings()}
              className="min-w-0 flex-1"
            />
          </aside>
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
            <div className="absolute inset-y-0 right-0 w-px bg-border/55 transition-colors group-hover:bg-border group-active:bg-primary/30" />
          </div>
        </>
      )}
      <section className="relative flex min-h-0 min-w-0 flex-1">
        <div className="amiba-chat-column relative flex min-h-0 min-w-0 flex-1 flex-col">
          <ContentHeader
            title={activeMain?.label || topBarPlaceholder}
            icon={contentHeaderIcon}
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => onSidebarCollapsedChange(false)}
            leftInset={topBarLeftInset}
            heightPx={topBarHeightPx}
            className={cn(
              topBarClassName,
              sidebarView === "chats" &&
                messagesWidth !== "full" &&
                "amiba-chat-header--wide-overlay",
            )}
            seamless={sidebarView === "chats"}
          />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {sidebarView === "scheduled" ? (
              <ScheduledTasksPage />
            ) : sidebarView === "tasks" ? (
              <TaskCenterPage />
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
            ) : activeMain ? (
              <ExtensionWebView
                src={activeMain.viewUrl}
                className="h-full w-full"
              />
            ) : null}
          </main>
        </div>
        <WorkspacePane visible={sidebarView === "chats"} />
        {sidebarView === "chats" && (
          <div
            data-workspace-edge-toggle
            className="app-no-drag absolute right-3 top-0 z-50 flex items-center"
            style={{ height: topBarHeightPx ?? 40 }}
          >
            <WorkspacePaneToggle />
          </div>
        )}
      </section>
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
// Independent pane headers
// ---------------------------------------------------------------------------

interface SidebarHeaderProps {
  onGoHome?: () => void;
  onSearch: () => void;
  onCollapse: () => void;
  leftInset?: number;
  heightPx?: number;
  className?: string;
}

function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="app-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

function SidebarHeader({
  onGoHome,
  onSearch,
  onCollapse,
  leftInset = 0,
  heightPx = 40,
  className,
}: SidebarHeaderProps) {
  const { t } = useT();
  return (
    <header
      className={cn("flex shrink-0 items-center pr-2", className)}
      style={{
        height: heightPx,
        paddingLeft: Math.max(leftInset, 8),
      }}
    >
      {onGoHome && (
        <HeaderAction label={t("chat.goHome")} onClick={onGoHome}>
          <Home className="h-4 w-4" />
        </HeaderAction>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <HeaderAction label={t("chat.search")} onClick={onSearch}>
          <Search className="h-4 w-4" />
        </HeaderAction>
        <HeaderAction label={t("chat.collapseSidebar")} onClick={onCollapse}>
          <PanelLeftClose className="h-4 w-4" />
        </HeaderAction>
      </div>
    </header>
  );
}

interface ContentHeaderProps {
  title: string;
  icon: ReactNode;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  leftInset?: number;
  heightPx?: number;
  className?: string;
  seamless?: boolean;
}

function ContentHeader({
  title,
  icon,
  sidebarCollapsed,
  onExpandSidebar,
  leftInset = 0,
  heightPx = 40,
  className,
  seamless = false,
}: ContentHeaderProps) {
  const { t } = useT();
  return (
    <header
      className={cn(
        "flex shrink-0 items-center bg-background px-3",
        !seamless && "border-b border-border/45",
        className,
      )}
      style={{
        height: heightPx,
      }}
    >
      <div
        data-content-header-leading
        className="flex min-w-0 items-center gap-2"
        style={{
          height: heightPx,
          left: sidebarCollapsed ? Math.max(leftInset, 12) : 12,
        }}
      >
        {sidebarCollapsed && (
          <HeaderAction
            label={t("chat.expandSidebar")}
            onClick={onExpandSidebar}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </HeaderAction>
        )}
        {title && (
          <div
            data-content-header-title
            className="pointer-events-none flex min-w-0 items-center gap-2 text-foreground/75"
          >
            <span className="shrink-0 text-muted-foreground">{icon}</span>
            <span className="truncate text-[13px] font-medium tracking-tight">
              {title}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
