/**
 * Full-screen chat surface — two direct side-by-side panes. Each pane owns
 * its own header so the window chrome reinforces the sidebar/content split
 * instead of placing an unrelated status strip across the whole app.
 *
 * The sidebar (`<Sidebar>`) is one column with three regions: a fixed top
 * (new-chat / search / DSH plugin nav rows), unified conversation
 * history, and a settings row pinned at the bottom. It replaces the old icon
 * `ActivityBar` rail + the `w-72` session-list aside.
 *
 * The main pane renders by `sidebarView`: the chat surface ("chats") or one
 * active DSH workspace contribution. Desktop uses it inside the main window.
 */

import { Folder, Home, PanelLeftClose, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from "react";

import { useSessions, type ChatEngineClient } from "@amiba/app-runtime/core";
import type { TriggerProvider } from "./composer/providers/types";
import type { ComposerTriggerRuntime } from "./composer/triggers/contracts";
import { useT } from "@amiba/i18n";
import { getPlatform, type StorageChangeMap } from "@amiba/app-runtime/platform";
import { useResolvedTheme } from "../theme";
import { cn } from "../primitives";
import { PaneHeaderBar } from "../navigation/PaneHeaderBar";
import { SidebarExpandControl } from "../navigation/SidebarExpandControl";
import type { ChatSurfaceCapabilities } from "./internal/capabilities";
import type { MessagesMaxWidth } from "./internal/types";
import { Sidebar, type ActivityViewId, type HistoryLayout } from "./Sidebar";
import { CommandPalette } from "./CommandPalette";
import { useCommandPalette } from "./useCommandPalette";
import { SessionTitleProvider, useSessionTitle } from "./useSessionTitle";
import ChatSurface from "./ChatSurface";
import type {
  ComposerModelPickerRenderer,
  ComposerPlanSeatRenderer,
} from "./Composer";
import type { ToolCallSeatRenderer } from "./bubble/tool-call-seat";
import {
  WorkspacePane,
  WorkspacePaneProvider,
  WorkspacePaneToggle,
  WorkspaceTerminalPanel,
  WorkspaceTerminalToggle,
  useWorkspacePane,
} from "./WorkspacePane";
import { EmbeddedBrowserToggle } from "./EmbeddedBrowserPane";
import {
  APP_SIDEBAR_DEFAULT_WIDTH,
  clampAppSidebarWidth,
  snapAppSidebarWidth,
} from "../navigation/sidebar-layout";

const MESSAGES_WIDTH_KEY = "settings.chat.messagesWidth";
const DEFAULT_MESSAGES_WIDTH: MessagesMaxWidth = "comfortable";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";
const DEFAULT_SIDEBAR_VIEW: ActivityViewId = "chats";

const SIDEBAR_WIDTH_KEY = "settings.chat.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "settings.chat.sidebarCollapsed";
const SIDEBAR_TRANSITION_FALLBACK_MS = 240;

type SidebarMotion = "idle" | "collapsing" | "expanding";

const HISTORY_LAYOUT_KEY = "settings.chat.historyLayout";
const DEFAULT_HISTORY_LAYOUT: HistoryLayout = "timeline";

function PrimaryWorkspaceView({
  active,
  testId,
  children,
}: {
  active: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={!active}
      {...(!active ? { inert: "" } : {})}
      className={cn(
        "min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        active ? "flex" : "hidden",
      )}
      data-testid={testId}
    >
      {children}
    </div>
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
  /** ChatEngineClient — desktop IPC backed by the managed DSH process. */
  client: ChatEngineClient;
  /** Optional desktop hand-off and workspace capabilities. */
  capabilities?: ChatSurfaceCapabilities;
  /** Slots forwarded to ChatSurface. */
  slots?: {
    /**
     * Rendered in the main pane when no session is active. Desktop hands
     * in ``<HomeView panelMode />`` so the home composer doubles as the
     * empty state instead of a separate route.
     */
    emptyState?: ReactNode;
    /** Additive DSH entries before built-in navigation rows. */
    navigationBefore?: ReactNode;
    /** DSH workspace plugin entries, rendered inside the existing sidebar. */
    workspaceNavigation?: (activeView: string) => ReactNode;
    /** Additive DSH entries after built-in navigation rows. */
    navigationAfter?: ReactNode;
    /** Active DSH workspace plugin body, keyed by the selected destination. */
    workspaceView?: (
      viewId: string,
      owner: {
        chromeHeightPx?: number;
        topBarLeftInset?: number;
        sidebarCollapsed: boolean;
        showSidebarExpandControl: boolean;
      },
    ) => ReactNode;
    /**
     * Title-adjacent per-session action row in the chat content header —
     * the host's dispatch of the official
     * `conversation.session.header.actions` seat. Rendered right of the
     * conversation title; an empty seat collapses to nothing (`empty:hidden`
     * on the row), so the header keeps its exact layout while no plugin
     * contributes.
     */
    headerActions?: ReactNode;
    /** Additive controls in the active chat header action cluster. */
    headerAfter?: ReactNode;
    /** Frame-wide overlay for chat modules; entries opt into pointer events. */
    contentOverlay?: ReactNode;
    /**
     * renderSlot-backed composer model-picker renderer, forwarded through
     * ChatSurface to the internal Composer.
     */
    modelPicker?: ComposerModelPickerRenderer;
    /**
     * renderSlot-backed dispatch of the official `conversation.input.plan`
     * seat, forwarded through ChatSurface to the internal Composer.
     */
    planSeat?: ComposerPlanSeatRenderer;
    /**
     * renderSlot-backed dispatch of the official `conversation.input.overlay`
     * seat, forwarded through ChatSurface to the internal Composer's card.
     */
    inputOverlay?: ReactNode;
    /**
     * renderSlot-backed dispatch of the official keyed `tool.call.toolview`
     * seat, forwarded through ChatSurface to every tool row in the
     * conversation. Omit it (Quick-Ask, any host outside a DSH plugin
     * runtime) and every row renders Amiba's own tool chip.
     */
    toolView?: ToolCallSeatRenderer;
    /**
     * renderSlot-backed dispatch of the official `settings.trigger` seat —
     * the content of the sidebar's settings row. The owner share is
     * `{ wide }`, the sidebar column state, which only this component knows,
     * so the host supplies a renderer rather than a node.
     */
    settingsTrigger?: (owner: { wide: boolean }) => ReactNode;
  };
  /**
   * Whether the settings dialog the sidebar row opens is currently open —
   * the sidebar trigger's `aria-expanded`, exactly as the official settings
   * shell reports its own open state.
   */
  settingsOpen?: boolean;
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
   * The OFFICIAL input-trigger pipeline, supplied by the DSH plugin host.
   * Forwarded verbatim to the inner `<ChatSurface triggerRuntime>` and on to
   * the composer, which drives the per-session `InputTriggerController`.
   */
  triggerRuntime?: ComposerTriggerRuntime;
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
  settingsOpen = false,
  openAgentDestination,
  onGoHome,
  topBarLeftInset,
  topBarHeightPx,
  topBarClassName,
  mentionProviders,
  triggerRuntime,
  restoreSidebarViewOnMount = true,
}: FullScreenChatViewProps) {
  useResolvedTheme();
  const { t } = useT();
  const sessions = useSessions();
  const palette = useCommandPalette();
  const [messagesWidth, setMessagesWidth] = useState<MessagesMaxWidth>(
    DEFAULT_MESSAGES_WIDTH,
  );
  const [sidebarView, setSidebarView] =
    useState<ActivityViewId>(DEFAULT_SIDEBAR_VIEW);
  const [sidebarWidth, setSidebarWidth] = useState(APP_SIDEBAR_DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMotion, setSidebarMotion] = useState<SidebarMotion>("idle");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [historyLayout, setHistoryLayout] = useState<HistoryLayout>(
    DEFAULT_HISTORY_LAYOUT,
  );
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [failedSessionIds, setFailedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const sidebarTransitionTimerRef = useRef<number | null>(null);

  const finishSidebarTransition = useCallback(() => {
    if (sidebarTransitionTimerRef.current !== null) {
      window.clearTimeout(sidebarTransitionTimerRef.current);
      sidebarTransitionTimerRef.current = null;
    }
    setSidebarMotion("idle");
  }, []);

  const setSidebarCollapsedTarget = useCallback(
    (next: boolean) => {
      if (sidebarCollapsedRef.current === next) return;
      sidebarCollapsedRef.current = next;

      if (sidebarTransitionTimerRef.current !== null) {
        window.clearTimeout(sidebarTransitionTimerRef.current);
        sidebarTransitionTimerRef.current = null;
      }

      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setSidebarMotion(
        reduceMotion ? "idle" : next ? "collapsing" : "expanding",
      );
      setSidebarCollapsed(next);

      if (!reduceMotion) {
        sidebarTransitionTimerRef.current = window.setTimeout(
          finishSidebarTransition,
          SIDEBAR_TRANSITION_FALLBACK_MS,
        );
      }
    },
    [finishSidebarTransition],
  );

  useEffect(
    () => () => {
      if (sidebarTransitionTimerRef.current !== null) {
        window.clearTimeout(sidebarTransitionTimerRef.current);
      }
    },
    [],
  );

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
    const setSessionFailed = (sessionId: string, failed: boolean) => {
      setFailedSessionIds((current) => {
        if (current.has(sessionId) === failed) return current;
        const next = new Set(current);
        if (failed) next.add(sessionId);
        else next.delete(sessionId);
        return next;
      });
    };

    const unsubscribeSnapshots = client.onSnapshot((frame) => {
      // A live snapshot recovers a run after the window or tab remounts.
      // Terminal snapshots may be responses to older requests, so stream
      // events remain authoritative for stopping an already-observed run.
      if (frame.kind === "live") {
        setSessionFailed(frame.sessionId, false);
        setSessionRunning(frame.sessionId, true);
      } else if (frame.kind === "interrupted") {
        setSessionFailed(frame.sessionId, true);
      }
    });
    const unsubscribeEvents = client.onStreamEvent((sessionId, event) => {
      const visibleSessionId = sidebarView === "chats" ? sessions.activeId : "";
      const completedInBackground =
        sessionId !== visibleSessionId &&
        (event.kind === "done" || event.kind === "error");

      if (event.kind === "begin") {
        setSessionFailed(sessionId, false);
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
        setSessionFailed(sessionId, event.kind === "error");
        setSessionRunning(sessionId, false);
      }
    });

    return () => {
      unsubscribeSnapshots();
      unsubscribeEvents();
    };
  }, [client, sessions.activeId, sessions.markUnread, sidebarView]);

  // External session authors wake their owning session instead of minting a
  // parallel transcript, so the chat list needs only the archive filter; no
  // local id convention may hide a valid DSH session.
  const chatSessions = useMemo(
    () => sessions.sessions.filter((s) => !s.archived),
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

  const chatTopBarPlaceholder = externalTitleOverride || activeChatTitle;
  const canRenameActiveChatTitle = Boolean(
    sessions.activeId && activeChatTitle && !externalTitleOverride,
  );
  const renameActiveChatTitle = useCallback(
    (title: string) => {
      if (!sessions.activeId) return;
      void sessions.rename(sessions.activeId, title);
    },
    [sessions.activeId, sessions.rename],
  );

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
      if (isSidebarCollapsed(v)) setSidebarCollapsedTarget(v);
    });
    const unsub = storage.watch(
      [SIDEBAR_COLLAPSED_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[SIDEBAR_COLLAPSED_KEY];
        if (ch && isSidebarCollapsed(ch.newValue))
          setSidebarCollapsedTarget(ch.newValue);
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [setSidebarCollapsedTarget]);

  useEffect(() => {
    let cancelled = false;
    const storage = getPlatform().storage;
    if (restoreSidebarViewOnMount) {
      void storage.get(SIDEBAR_VIEW_KEY).then((r) => {
        if (cancelled) return;
        const v = r[SIDEBAR_VIEW_KEY];
        if (isSidebarView(v)) {
          setSidebarView(v === "tasks" ? "chats" : v);
        }
      });
    }
    const unsub = storage.watch(
      [SIDEBAR_VIEW_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[SIDEBAR_VIEW_KEY];
        if (ch && isSidebarView(ch.newValue)) {
          setSidebarView(ch.newValue === "tasks" ? "chats" : ch.newValue);
        }
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
      if (isSidebarWidth(v)) setSidebarWidth(clampAppSidebarWidth(v));
    });
    const unsub = storage.watch(
      [SIDEBAR_WIDTH_KEY],
      (changes: StorageChangeMap) => {
        const ch = changes[SIDEBAR_WIDTH_KEY];
        if (ch && isSidebarWidth(ch.newValue))
          setSidebarWidth(clampAppSidebarWidth(ch.newValue));
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
        width = snapAppSidebarWidth(startWidth + (ev.clientX - startX));
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

  const workspacePane = useWorkspacePane();

  const onSidebarViewChange = useCallback((next: ActivityViewId) => {
    if (next === "tasks") next = "chats";
    setSidebarView(next);
    void getPlatform().storage.set({ [SIDEBAR_VIEW_KEY]: next });
  }, []);

  const onHistoryLayoutChange = useCallback((next: HistoryLayout) => {
    setHistoryLayout(next);
    void getPlatform().storage.set({ [HISTORY_LAYOUT_KEY]: next });
  }, []);

  const onSidebarCollapsedChange = useCallback(
    (next: boolean) => {
      setSidebarCollapsedTarget(next);
      void getPlatform().storage.set({ [SIDEBAR_COLLAPSED_KEY]: next });
    },
    [setSidebarCollapsedTarget],
  );

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

  const primaryWorkspaceActive = sidebarView === "chats";
  const pluginWorkspaceActive = !primaryWorkspaceActive;
  const showSidebarExpandControl = sidebarCollapsed && sidebarMotion === "idle";
  const showSidebarCollapseControl =
    !sidebarCollapsed && sidebarMotion === "idle";
  const headerIconBoxesVisible = sidebarMotion === "idle";

  useEffect(() => {
    if (sidebarView !== "chats" || !sessions.activeId) {
      setTerminalOpen(false);
    }
  }, [sessions.activeId, sidebarView]);

  const onSidebarWidthTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLElement>) => {
      if (
        event.target === event.currentTarget &&
        event.propertyName === "width"
      ) {
        finishSidebarTransition();
      }
    },
    [finishSidebarTransition],
  );
  // Layout: the sidebar and content region are direct siblings. The content
  // region keeps chat and workbench in one row, with the terminal drawer as a
  // separate bottom row so it can span the active workspace like an IDE pane.
  return (
    <div className="flex h-screen min-h-0 w-full bg-background text-foreground">
      <aside
        data-testid="main-sidebar"
        aria-hidden={sidebarCollapsed}
        {...(sidebarCollapsed ? { inert: "" } : {})}
        className="min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
        onTransitionEnd={onSidebarWidthTransitionEnd}
        style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
      >
        <div
          data-testid="main-sidebar-content"
          className="flex h-full min-h-0 shrink-0 flex-col bg-muted/30"
          style={{ width: sidebarWidth }}
        >
          <SidebarHeader
            onGoHome={onGoHome}
            onSearch={() => palette.setOpen(true)}
            onCollapse={() => onSidebarCollapsedChange(true)}
            showCollapseControl={showSidebarCollapseControl}
            iconBoxVisible={headerIconBoxesVisible}
            leftInset={topBarLeftInset}
            heightPx={topBarHeightPx}
            className={topBarClassName}
          />
          <Sidebar
            navigationBefore={slots?.navigationBefore}
            workspaceNavigation={slots?.workspaceNavigation?.(sidebarView)}
            navigationAfter={slots?.navigationAfter}
            onNewChat={() => void onNewChatAndShow()}
            sessions={chatSessions}
            runningSessionIds={runningSessionIds}
            failedSessionIds={failedSessionIds}
            activeSessionId={sessions.activeId}
            sessionsReady={sessions.ready}
            onOpenSession={(id) => void onOpenSession(id)}
            onRenameSession={(id, title) => void sessions.rename(id, title)}
            onDeleteSession={(id) => void sessions.remove(id)}
            onPinSession={(id, pinned) => sessions.setPinned(id, pinned)}
            onArchiveSession={(id, archived) =>
              sessions.setArchived(id, archived)
            }
            onBranchSession={async (id) => {
              await sessions.branchSession(id);
            }}
            onExportSession={async (id) => {
              try {
                const payload = await sessions.exportSession(id);
                const title =
                  sessions.sessions.find((item) => item.id === id)?.title ||
                  "task";
                const filename = `${title.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 60) || "task"}.amiba-session.json`;
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(payload, null, 2)], {
                    type: "application/json",
                  }),
                );
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = filename;
                anchor.click();
                URL.revokeObjectURL(url);
              } catch (error) {
                window.alert(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
            onBulkSessions={(ids, action) => sessions.bulkUpdate(ids, action)}
            onRefreshSessions={() => void sessions.refresh()}
            historyLayout={historyLayout}
            onHistoryLayoutChange={onHistoryLayoutChange}
            onOpenSettings={() => openSettings()}
            settingsTrigger={slots?.settingsTrigger}
            settingsOpen={settingsOpen}
            wide={!sidebarCollapsed}
            className="min-w-0 flex-1"
          />
        </div>
      </aside>
      {/* Resize divider: invisible 4px hit area straddling the sidebar edge. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chat.resizeSidebar")}
        aria-hidden={sidebarCollapsed}
        data-testid="sidebar-resize-handle"
        onPointerDown={onSidebarResizeStart}
        className={cn(
          "group relative -ml-1 w-1 shrink-0 touch-none",
          sidebarCollapsed
            ? "pointer-events-none opacity-0"
            : "cursor-col-resize opacity-100",
        )}
      >
        <div className="absolute inset-y-0 right-0 w-px bg-border/35 transition-colors group-hover:bg-foreground/[0.07] group-active:bg-foreground/[0.10]" />
      </div>
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          data-workspace-main-row
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <div className="amiba-chat-column relative flex min-h-0 min-w-0 flex-1 flex-col">
            <PrimaryWorkspaceView
              active={sidebarView === "chats"}
              testId="chats-view"
            >
              <ContentHeader
                title={chatTopBarPlaceholder}
                icon={<Folder className="h-4 w-4" />}
                actions={slots?.headerActions}
                onRenameTitle={
                  canRenameActiveChatTitle ? renameActiveChatTitle : undefined
                }
                sidebarCollapsed={sidebarCollapsed}
                showExpandControl={showSidebarExpandControl}
                iconBoxVisible={headerIconBoxesVisible}
                onExpandSidebar={() => onSidebarCollapsedChange(false)}
                leftInset={topBarLeftInset}
                heightPx={topBarHeightPx}
                className={cn(
                  topBarClassName,
                  messagesWidth !== "full" && "amiba-chat-header--wide-overlay",
                )}
                seamless
              />
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ChatSurface
                  messagesMaxWidth={messagesWidth}
                  client={client}
                  capabilities={capabilities}
                  slots={slots}
                  openSettings={openSettings}
                  openAgentDestination={openAgentDestination}
                  mentionProviders={mentionProviders}
                  triggerRuntime={triggerRuntime}
                />
              </main>
            </PrimaryWorkspaceView>
            <PrimaryWorkspaceView
              active={pluginWorkspaceActive}
              testId="plugin-workspace-view"
            >
              {slots?.workspaceView?.(sidebarView, {
                chromeHeightPx: topBarHeightPx,
                topBarLeftInset,
                sidebarCollapsed,
                showSidebarExpandControl,
              })}
            </PrimaryWorkspaceView>
          </div>
          <WorkspacePane visible={sidebarView === "chats"} />
        </div>
        <WorkspaceTerminalPanel
          visible={sidebarView === "chats"}
          open={terminalOpen}
          onClose={() => setTerminalOpen(false)}
        />
        {sidebarView === "chats" && (
          <div
            data-workspace-edge-toggle
            className="app-no-drag absolute right-3 top-0 z-50 flex items-center gap-0.5"
            style={{ height: topBarHeightPx ?? 40 }}
          >
            {slots?.headerAfter}
            <EmbeddedBrowserToggle
              open={
                workspacePane.open &&
                workspacePane.activeTab?.resource.kind === "browser"
              }
              onToggle={() => {
                if (
                  workspacePane.open &&
                  workspacePane.activeTab?.resource.kind === "browser"
                ) {
                  workspacePane.setOpen(false);
                } else {
                  workspacePane.openBrowser();
                }
              }}
            />
            <WorkspaceTerminalToggle
              open={terminalOpen}
              onToggle={() => setTerminalOpen((current) => !current)}
              showUnavailable
            />
            <WorkspacePaneToggle showUnavailable />
          </div>
        )}
        {slots?.contentOverlay ? (
          <div
            data-amiba-slot="amiba.chat.content.overlay"
            className="pointer-events-none absolute inset-0 z-[60]"
          >
            {slots.contentOverlay}
          </div>
        ) : null}
      </section>
      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
        sessions={chatSessions}
        onOpenSession={(id) => void onOpenSession(id)}
        onNewChat={() => void onNewChatAndShow()}
        onOpenSettings={() => openSettings()}
        onSearchSessions={sessions.searchHistory}
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
  showCollapseControl?: boolean;
  iconBoxVisible?: boolean;
  leftInset?: number;
  heightPx?: number;
  className?: string;
}

function HeaderIconBox({
  visible,
  testId,
  className,
  children,
}: {
  visible: boolean;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={!visible}
      {...(!visible ? { inert: "" } : {})}
      className={cn(
        "flex shrink-0 items-center",
        visible ? "visible" : "invisible pointer-events-none",
        className,
      )}
      data-testid={testId}
    >
      {children}
    </div>
  );
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
  showCollapseControl = true,
  iconBoxVisible = true,
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
      <HeaderIconBox
        visible={iconBoxVisible}
        testId="sidebar-header-icon-box"
        className="w-full"
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
          <span className="h-7 w-7 shrink-0">
            {showCollapseControl ? (
              <HeaderAction
                label={t("chat.collapseSidebar")}
                onClick={onCollapse}
              >
                <PanelLeftClose className="h-4 w-4" />
              </HeaderAction>
            ) : null}
          </span>
        </div>
      </HeaderIconBox>
    </header>
  );
}

interface ContentHeaderProps {
  title: string;
  icon: ReactNode;
  /**
   * Per-session action row rendered immediately right of the title. Host
   * content only — the header neither knows nor cares that the node comes
   * from the official `conversation.session.header.actions` seat. Nothing
   * to render means no row: the wrapper carries `empty:hidden`, so an
   * unoccupied seat costs neither a box nor a flex gap.
   */
  actions?: ReactNode;
  onRenameTitle?: (title: string) => void;
  sidebarCollapsed: boolean;
  showExpandControl?: boolean;
  iconBoxVisible?: boolean;
  onExpandSidebar: () => void;
  leftInset?: number;
  heightPx?: number;
  className?: string;
  seamless?: boolean;
}

function ContentHeader({
  title,
  icon,
  actions,
  onRenameTitle,
  sidebarCollapsed,
  showExpandControl = sidebarCollapsed,
  iconBoxVisible = true,
  onExpandSidebar,
  leftInset = 0,
  heightPx = 40,
  className,
  seamless = false,
}: ContentHeaderProps) {
  const [titleEditing, setTitleEditing] = useState(false);

  return (
    <PaneHeaderBar
      heightPx={heightPx}
      leftInset={sidebarCollapsed ? leftInset : 0}
      bordered={!seamless}
      className={cn(titleEditing && "app-no-drag", className)}
      onPointerDown={(event) => {
        if (!titleEditing) return;
        if (
          event.target instanceof Element &&
          event.target.closest("[data-content-header-title-editor]")
        ) {
          return;
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }}
      leading={
        <div
          data-content-header-leading
          className="flex min-w-0 items-center gap-2.5"
          style={{ height: heightPx }}
        >
          <HeaderIconBox
            visible={iconBoxVisible}
            testId="content-header-icon-box"
          >
            <SidebarExpandControl
              collapsed={sidebarCollapsed}
              onExpand={onExpandSidebar}
              visible={showExpandControl}
            />
            {title ? (
              <span
                className={cn(
                  "pointer-events-none shrink-0 text-muted-foreground",
                  sidebarCollapsed && "ml-2",
                )}
              >
                {icon}
              </span>
            ) : null}
          </HeaderIconBox>
          {title && (
            <EditableContentHeaderTitle
              title={title}
              onRename={onRenameTitle}
              onEditingChange={setTitleEditing}
            />
          )}
          {/* Title-adjacent action row. `empty:hidden` is load-bearing: an
              unoccupied seat renders no DOM inside this wrapper, and a
              zero-child flex item would still spend one parent gap. Hidden
              means no box AND no gap — the header is pixel-identical to a
              build without the seat. */}
          {actions ? (
            <div
              data-content-header-actions
              className="app-no-drag flex min-w-0 shrink-0 items-center gap-0.5 empty:hidden"
            >
              {actions}
            </div>
          ) : null}
        </div>
      }
    />
  );
}

function EditableContentHeaderTitle({
  title,
  onRename,
  onEditingChange,
}: {
  title: string;
  onRename?: (title: string) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const editorRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!editing) return;
    editorRef.current?.focus();
    editorRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  useEffect(() => {
    if (!onRename) {
      setEditing(false);
      onEditingChange?.(false);
    }
  }, [onEditingChange, onRename]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next && next !== title.trim()) onRename?.(next);
    setEditing(false);
    onEditingChange?.(false);
  }, [draft, onEditingChange, onRename, title]);

  const cancel = useCallback(() => {
    setDraft(title);
    setEditing(false);
    onEditingChange?.(false);
  }, [onEditingChange, title]);

  const onEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    },
    [cancel, commit],
  );

  return (
    <div data-content-header-title className="min-w-0 text-foreground/75">
      {editing ? (
        <input
          ref={editorRef}
          data-content-header-title-editor
          aria-label={t("chat.rename")}
          className="app-no-drag -my-1 -ml-1 min-w-[8ch] max-w-[min(32rem,50vw)] rounded-md bg-foreground/[0.045] px-1 py-1 text-[13px] font-medium tracking-tight text-foreground outline-none [field-sizing:content] selection:bg-primary/20 focus-visible:ring-1 focus-visible:ring-ring/40"
          value={draft}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onEditorKeyDown}
        />
      ) : onRename ? (
        <button
          type="button"
          aria-label={t("chat.rename")}
          title={t("chat.rename")}
          className="app-no-drag -my-1 -ml-1.5 min-w-0 cursor-default truncate rounded-xl px-1.5 py-1 text-left text-[13px] font-medium tracking-tight transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          onClick={() => {
            setDraft(title);
            setEditing(true);
            onEditingChange?.(true);
          }}
        >
          {title}
        </button>
      ) : (
        <span className="pointer-events-none truncate text-[13px] font-medium tracking-tight">
          {title}
        </span>
      )}
    </div>
  );
}
