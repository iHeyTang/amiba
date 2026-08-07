import {
  Bot,
  ChevronDown,
  ChevronUp,
  Disc,
  Eye,
  Globe,
  History,
  Loader2,
  MousePointerClick,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useT, type MessageKey, type TranslateFn } from "@amiba/i18n";
import { getPlatform, type StorageChangeMap } from "@amiba/platform";
import { useResolvedTheme } from "../theme";
import { Button, AmibaLogo, ScrollArea } from "../primitives";
import { cn } from "../primitives";
import { shortId } from "@amiba/utils";
// Wire-protocol types + engine + helpers — everything that was previously
// imported from extension-local paths now lives in @amiba/core.
import {
  attachmentToBadge,
  classify,
  deleteAttachmentFile,
  formatBytesShort,
  formatFileAttachmentsForPrompt,
  getHermesProfiles,
  isAttachmentReadOk,
  isLocalChannel,
  normalizeAgentContext,
  postHermesApprovalDecision,
  readBlobAsAttachment,
  resolveChannel,
  transcribeAudio,
  triggerHermesAutoTitle,
  useSessions,
  useVoicePrefs,
  DEFAULT_HERMES_MODEL,
  HERMES_APPROVAL_GATEWAY_TIMEOUT_MS,
  type AgentExecutionContext,
  type ApprovalOutcome,
  type ApprovalRecord,
  type Attachment,
  type AttachmentBadge,
  type AttachmentKind,
  type AttachmentReadResult,
  type ChatEngineClient,
  type ChatMessage,
  type ChatRuntimeState,
  type HermesApprovalDecision,
  type HermesApprovalRequest,
  type HermesToolProgress,
  type SnapshotFrame,
  type StreamEvent,
  type StreamedToolCall,
  type TurnMetadata,
} from "@amiba/core";

// Sub-components + helpers + UI types live next to this file in chat-ui.
import { ApprovalBanner } from "./bubble/approval";
import { ErrorBlock } from "./bubble/chips";
import { MessageTurns } from "./bubble/Bubble";
import { useWorkspacePane } from "./WorkspacePane";
import {
  Composer,
  type ComposerDensity,
  type ComposerHandle,
  type ComposerPickerOverlayVariant,
} from "./Composer";
import { ConversationTurnRail } from "./ConversationTurnRail";
import { useComposerAttachments } from "./useComposerAttachments";
import { useVoiceRecorder } from "./useVoiceRecorder";
import { SessionDrawer } from "./SessionDrawer";
import { TabBar } from "./TabBar";
import {
  bubbleTextContent,
  formatToolDuration,
  hostnameOf,
  splitThinkingFromBody,
} from "./internal/helpers";
import {
  type AssistantTimelineItem,
  type ChatError,
  type MessagesMaxWidth,
  type UiMessage,
} from "./internal/types";

// Capability interfaces let extension-only features (page-context, learn,
// navigateOpenPolicy) plug in without polluting this file with chrome.* APIs.
import type {
  NavigateOpenPolicy,
  PendingPromptResult,
  ChatSurfaceCapabilities,
} from "./internal/capabilities";
import type { TriggerProvider } from "./composer/providers/types";
import { PendingQueueRail } from "./internal/PendingQueueRail";
import { useApprovals } from "./internal/useApprovals";
import { useConversationWorkspace } from "./internal/useConversationWorkspace";
import { useLearnMode } from "./internal/useLearnMode";
import {
  pendingQueueStorageKey,
  previewPendingTurn,
  usePendingQueue,
  type PendingChatTurn,
  type RunChatTurnArgs,
} from "./internal/usePendingQueue";
import { useStreamBuffer } from "./internal/useStreamBuffer";

const SETTINGS_KEYS = {
  model: "settings.chat.model",
  /** Where navigate opens + (when not Auto) where all browser tools run. */
  navigateOpenPolicy: "settings.sidepanel.navigateOpenPolicy",
};

// applyOpenPolicyToRunTarget moved into the extension wrapper as part of
// NavigateOpenPolicyCapability — chrome.runtime/windows/tabs all live there.

// UiMessage / AssistantTimelineItem / ChatError / COMPOSER_TEXTAREA_MAX_PX
// now live in @amiba/chat-ui (alongside the rendering components).
// Imported below in the consolidated import block.

// PendingChatTurn / previewPendingTurn / pendingQueueStorageKey now
// live in internal/usePendingQueue.ts (the queue subsystem owns its own
// types + helpers). Imported above.

// openAgentDestinationInUserWindow lives in the extension wrapper as a
// concrete chrome.windows + chrome.tabs implementation; ChatSurface
// receives it as the `openAgentDestination` prop.

// ChatError moved to @amiba/chat-ui (see consolidated import block).

/**
 * Layout variants:
 *  - "sidebar"     — Plasmo side panel; owns the viewport with `h-screen`,
 *                    shows its own TabBar at the top.
 *  - "fullscreen"  — embedded inside the standalone chat tab (chat.html).
 *                    Fills its parent with `h-full` and hides the TabBar
 *                    because the chat tab renders sessions in a right rail
 *                    instead.
 *
 * Chat state, composer, message rendering, and approvals are identical
 * across variants — only chrome (root height + TabBar) differs.
 */
/**
 * Width preset for the messages column in `variant="fullscreen"`. The
 * composer keeps a fixed cap regardless; only the message flow above it
 * resizes. Ignored in `variant="sidebar"` (the side panel is already a
 * narrow column). Re-exported from @amiba/chat-ui so external surfaces
 * (e.g. tabs/chat.tsx) that import it from `~sidepanel/index` still work.
 */
// (MessagesMaxWidth type itself is imported in the consolidated block at the
// top of this file; we re-export it for external callers.)
export type { MessagesMaxWidth };

// Narrow matches the composer's max-w-3xl cap so messages never end up
// narrower than the input below them (jarring visually). Comfortable
// widens past the composer; full lets messages span the entire pane.
const MESSAGES_MAX_WIDTH_CLASS: Record<MessagesMaxWidth, string> = {
  narrow: "mx-auto w-full max-w-3xl",
  comfortable: "mx-auto w-full max-w-4xl",
  full: "",
};

export interface ChatSurfaceProps {
  variant?: "sidebar" | "fullscreen";
  messagesMaxWidth?: MessagesMaxWidth;
  /**
   * What to render when no active session OR active session has no
   * messages yet.
   *
   *  - ``"hero"`` (default): the built-in centred logo + greeting +
   *    composer block, OR ``slots.emptyState`` when provided.
   *  - ``"composer-only"``: skip the hero entirely, render just the
   *    composer (with quick-action chips enabled) at the bottom of a
   *    content-sized container. Used by the Quick-Ask popup so its
   *    window can shrink-wrap to the input row while still mounting
   *    the *same* ChatSurface body as the desktop main window.
   */
  emptyState?: "hero" | "composer-only";
  /**
   * Forwarded to the internal Composer's ``autoFocus`` so callers like
   * Quick-Ask can land the cursor in the textarea on first mount
   * without reaching through the ref. Default ``false`` — the side
   * panel and full-screen surfaces don't grab focus on entry
   * (would steal it from whatever the user was reading).
   */
  composerAutoFocus?: boolean;

  /**
   * Quick-Ask only. Set when the host gives its composer-only surface an
   * explicit card height. The ChatSurface then fills that card and pins its
   * persistent Composer dock to the bottom, whether the card is compact or
   * has grown around a multiline draft. Modal visibility must never drive
   * this flag. Never set by sidebar/main-window surfaces; does NOT alter
   * `isComposerOnlyEmpty` (kept stable so the Composer never remounts).
   */
  composerOnlyExpanded?: boolean;

  /**
   * Keep the same Composer DOM host mounted while a composer-only surface
   * moves between its id-less empty state and an active conversation. Quick
   * Ask uses this to preserve editor focus and picker state across its first
   * turn and New chat transitions. Other surfaces retain their existing
   * empty-state placement by default.
   */
  persistComposerAcrossModes?: boolean;

  /**
   * Optional host-level frame treatment for the shared Composer. Floating
   * shells such as Quick Ask use this to embed the input into their single
   * outer surface instead of drawing a second bordered card inside it.
   */
  composerFrameClassName?: string;

  /** Density forwarded to the shared Composer. */
  composerDensity?: ComposerDensity;

  /**
   * Reports the live outer Composer dock height. Floating shells use this to
   * grow their visible panel with multiline drafts instead of letting the
   * editor push the toolbar outside a fixed-height card.
   */
  onComposerHeightChange?: (height: number) => void;

  /** Overlay treatment used by the composer's model and Profile modals. */
  composerPickerOverlayVariant?: ComposerPickerOverlayVariant;

  /** Height treatment used by the composer's model and Profile modals. */
  composerPickerDialogSize?: "default" | "tall";

  /** Reload composer picker state when a persistent host is shown again. */
  composerPickerRefreshKey?: number;

  /**
   * Increment to run ChatSurface's own New chat reset without remounting the
   * persistent Composer or its picker state.
   */
  newConversationRequestKey?: number;

  /** Optional visual treatment for the ChatSurface root. */
  surfaceClassName?: string;

  /**
   * Quick-Ask only. Called whenever the composer draft toggles between
   * empty and non-empty. Quick-Ask uses it to STAY expanded while a draft
   * exists, so dismissing the slash/@ menu mid-compose doesn't snap the
   * window back to compact. Never set by other surfaces (no-op there).
   */
  onComposerEmptyChange?: (empty: boolean) => void;

  /**
   * Chat engine the view talks to. Extension provides ChromeChatEngineClient
   * (wraps `chrome.runtime.connect({ name: CHAT_PORT_NAME })`); desktop
   * provides ElectronChatEngineClient (IPC to main-process HermesClient).
   */
  client: ChatEngineClient;

  /**
   * Extension-only capabilities. When omitted, the corresponding UI hides:
   *  - `pageContext` undefined → no live page chip, no pin button, no
   *                              drag-paste page snapshot row
   *  - `learn` undefined → no Record/Stop buttons
   *  - `navigateOpenPolicy` undefined → no NavigateOpenPolicyToggle in
   *                                     the composer toolbar (slot still
   *                                     respected if caller provides one)
   *  - `pendingPrompt` undefined → no auto-fire on mount
   */
  capabilities?: ChatSurfaceCapabilities;

  /**
   * UI slots for surface-specific extras that aren't expressed by capabilities
   * (they're whole React subtrees, not behaviour). Extension supplies the
   * BridgeStatusBar + the NavigateOpenPolicyToggle component; desktop omits
   * them.
   */
  slots?: {
    /** Above the composer — extension renders `<BridgeStatusBar />`. */
    bridgeBar?: ReactNode;
    /**
     * Render-prop for the NavigateOpenPolicyToggle slot in the composer
     * toolbar. The toggle needs internal ChatSurface state (current
     * policy + change handler) so we pass them in as ctx. Extension
     * returns `<NavigateOpenPolicyToggle ...ctx />`; desktop omits.
     */
    navigateOpenPolicyToggle?: (ctx: {
      policy: NavigateOpenPolicy;
      onChange: (next: NavigateOpenPolicy) => void;
    }) => ReactNode;
    /**
     * Rendered when there's no active session. Desktop passes
     * ``<HomeView panelMode />`` here so the empty state looks and
     * behaves like the standalone home page. When omitted, the panel
     * falls back to a built-in greeting + the canonical chat composer
     * centred in the main area.
     */
    emptyState?: ReactNode;
  };

  /**
   * Extra @ providers contributed by host apps (e.g. desktop's @file,
   * extension's @page). Forwarded verbatim to `<Composer mentionProviders>`.
   * Leave undefined to use only the built-in skills / slash / sessions /
   * personas / channels providers.
   */
  mentionProviders?: TriggerProvider[];

  /**
   * Open Settings, optionally at the recovery pane chosen by ErrorBlock.
   * Extension hosts may ignore the pane; desktop uses SettingsView hash
   * routing to land directly on models, connection, voice, or error logs.
   */
  openSettings: (tab?: string) => void;

  /**
   * Open an agent-destination URL in the user's primary browser/window.
   * Extension impl uses chrome.windows + chrome.tabs; desktop uses
   * `shell.openExternal`.
   */
  openAgentDestination: (url: string) => void | Promise<void>;
}

export type ChatSurfaceMode = "home" | "conversation";

/**
 * The home surface is a navigation state, not a property of the message log.
 * In particular, a persisted conversation with zero messages remains a
 * conversation view.
 */
export function resolveChatSurfaceMode(activeId: string): ChatSurfaceMode {
  return activeId ? "conversation" : "home";
}

export function shouldMountComposerDock(
  hasActive: boolean,
  isComposerOnlyEmpty: boolean,
  persistComposerAcrossModes: boolean,
): boolean {
  return hasActive || (isComposerOnlyEmpty && persistComposerAcrossModes);
}

/**
 * Measure the dock at the editor's final auto-grow height. During a CSS height
 * transition `getBoundingClientRect()` returns an intermediate frame; sizing a
 * shell from that value makes the outer card trail behind the moving text.
 */
export function measureComposerDockTargetHeight(dock: HTMLElement): number {
  const dockHeight = dock.getBoundingClientRect().height;
  const editor = dock.querySelector<HTMLElement>("[data-auto-grow-editor]");
  if (!editor) return Math.ceil(dockHeight);

  const targetHeight = Number(editor.dataset.autoGrowTargetHeight);
  if (!Number.isFinite(targetHeight)) return Math.ceil(dockHeight);

  const currentEditorHeight = editor.getBoundingClientRect().height;
  return Math.ceil(dockHeight - currentEditorHeight + targetHeight);
}

export default function ChatSurface({
  variant = "sidebar",
  messagesMaxWidth = "comfortable",
  emptyState = "hero",
  composerAutoFocus = false,
  composerOnlyExpanded = false,
  persistComposerAcrossModes = false,
  composerFrameClassName,
  composerDensity = "default",
  onComposerHeightChange,
  composerPickerDialogSize = "default",
  composerPickerOverlayVariant = "dimmed",
  composerPickerRefreshKey = 0,
  newConversationRequestKey = 0,
  surfaceClassName,
  onComposerEmptyChange,
  client,
  capabilities = {},
  slots,
  mentionProviders,
  openSettings,
  openAgentDestination,
}: ChatSurfaceProps) {
  // The side panel sits next to the user's active tab, so we let the user
  // opt into mirroring that page's theme via Settings → Theme = "Match
  // active page". Other preferences (`auto`/`light`/`dark`) behave the same
  // as in the popup/options.
  useResolvedTheme();
  const { t } = useT();

  const sessions = useSessions();
  const hasActive =
    resolveChatSurfaceMode(sessions.activeId) === "conversation";
  const workspacePane = useWorkspacePane();

  const [input, setInput] = useState("");
  const handledNewConversationRequestRef = useRef(newConversationRequestKey);
  const defaultProfileIdRef = useRef("default");
  const [draftAgent, setDraftAgent] = useState<AgentExecutionContext>({
    profileId: "default",
  });
  const currentSessionMeta = sessions.sessions.find(
    (session) => session.id === sessions.activeId,
  );
  const effectiveAgent = normalizeAgentContext(
    currentSessionMeta?.agent ?? draftAgent,
  );
  const profileLocked =
    Boolean(currentSessionMeta?.messageCount) ||
    sessions.activeMessages.some((message) => message.role === "user");

  useEffect(() => {
    let alive = true;
    void getHermesProfiles().then((result) => {
      if (!alive || !result.ok) return;
      defaultProfileIdRef.current = result.active || "default";
      if (!sessions.activeId) {
        setDraftAgent((current) =>
          current.profileId === "default" && !current.personality
            ? { profileId: defaultProfileIdRef.current }
            : current,
        );
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (currentSessionMeta?.agent) {
      const next = normalizeAgentContext(currentSessionMeta.agent);
      setDraftAgent((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    } else if (!sessions.activeId) {
      setDraftAgent({ profileId: defaultProfileIdRef.current });
    }
  }, [currentSessionMeta?.agent, sessions.activeId]);

  // Report composer empty/non-empty to hosts that care (Quick-Ask uses it
  // to stay expanded while there's a draft). No-op when the callback is
  // omitted, i.e. for every non-Quick-Ask surface.
  useEffect(() => {
    onComposerEmptyChange?.(input.trim().length === 0);
  }, [input, onComposerEmptyChange]);
  // Bumped by the pendingPrompt subscription so the drain effect
  // re-fires on push notifications even when the session id hasn't
  // changed (e.g. the empty-state home composer submitting into an
  // already-active empty session).
  const [pendingPromptTick, setPendingPromptTick] = useState(0);
  // Set when the new-tab Home launcher hands off a prompt via
  // `chrome.storage.local.home.pendingPrompt`. We populate the composer
  // with the text and then auto-fire `send()` once the panel is ready —
  // the user already pressed Enter on Home, so an extra Send click here
  // would be friction.
  const [pendingAutosend, setPendingAutosend] = useState(false);
  // Origin hint for a hand-off prompt (e.g. "Safari" from Quick-Ask
  // Spotlight). Rendered as a chip above the composer; cleared once the
  // user starts typing or sends, so it doesn't follow them around past
  // the turn it belongs to.
  const [pendingSourceApp, setPendingSourceApp] = useState<string | null>(null);
  // A workspace selected on the id-less HomeView cannot be bound yet. The
  // pending-prompt hand-off parks it here until runChatTurn mints the real
  // session id, then binds it before any message reaches Hermes.
  const pendingWorkspacePathRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Cron session click → open the existing SessionDB row as a tab. The
  // drawer's Scheduled-tasks group now lists cron-source sessions from
  // SessionDB directly (matches ``hermes sessions list --source cron``),
  // so the row already exists and we just need to bring it to front.
  const onOpenCronSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (sessionId === sessions.activeId) {
        await sessions.deselect();
        return;
      }
      await sessions.openTab(sessionId);
    },
    [sessions],
  );
  const [config, setConfig] = useState({
    model: DEFAULT_HERMES_MODEL,
  });
  // Persisted across panel reloads so toggling "include current page"
  // survives the SW restarts that happen whenever the side panel is
  // closed and re-opened. We default to `true` so a fresh install
  /**
   * Open: Auto / Agent / New tab / Same tab — single control for where browser
   * tools run. Non-Auto pins `runTarget` in the service worker; Auto leaves
   * `runTarget` to `my_browser_navigate` + model `open_in` (defaulting to the
   * agent window when still ambiguous). Persisted in chrome.storage.local.
   */
  const [navigateOpenPolicy, setNavigateOpenPolicy] =
    useState<NavigateOpenPolicy>("auto");
  // ``pageError`` outlives the pin button because non-pin flows
  // (microphone permission, etc.) still surface here. Pin's send-time
  // snapshot capture swallows failures rather than promoting them to
  // this banner — the agent's tools degrade gracefully when no snapshot
  // arrives, and the user shouldn't have to dismiss a warning for a
  // capture they never explicitly requested.
  const [pageError, setPageError] = useState<string | null>(null);
  // Composer-time uploads — owned by the shared `useComposerAttachments`
  // hook so this surface, HomeView, and the Quick-Ask popup all share
  // one implementation. The hook owns picker / paste / upload state +
  // the hidden file-input wiring; the destructuring below keeps the
  // existing variable names so the rest of the component (queue editor,
  // session-switch GC, drain effect, …) is untouched.
  // The whole hook result is passed to Composer via the `attachments`
  // prop — Composer wires the paperclip / chip row / paste / drop /
  // hidden file input internally. The destructure below preserves the
  // local variable names so the rest of the component (queue editor,
  // session-switch GC, drain effect, …) compiles untouched.
  // Attachment bytes need a directory before a conversation exists. Keep
  // them under a transient composer id while the home surface is active;
  // only `runChatTurn()` may mint the real conversation id.
  const draftUploadSessionRef = useRef(shortId("draft"));
  const att = useComposerAttachments({
    getSessionId: () => sessions.activeId || draftUploadSessionRef.current,
  });
  const {
    attachments,
    setAttachments,
    attachmentUploading,
    attachmentBusy,
    setAttachmentBusy,
    attachmentError,
    setAttachmentError,
    addFiles,
  } = att;
  const learnMode = useLearnMode({
    learn: capabilities.learn,
    pageContext: capabilities.pageContext,
    sessions,
    attachmentControls: {
      setAttachments,
      setAttachmentBusy,
      setAttachmentError,
    },
    setPageError,
    t,
  });
  const {
    recording: learnRecording,
    eventCount: learnEventCount,
    stopBusy: learnStopBusy,
    start: startLearnFromPanel,
    stopAndAttach: stopLearnToComposer,
  } = learnMode;
  // Conversation workspaces are read-only here. The id-less Home surface
  // chooses the directory and the first send binds it to the newly-created
  // session; switching conversations only restores that immutable binding.
  const { workspacePath, workspaceError, setWorkspaceError } =
    useConversationWorkspace({ sessions });
  useEffect(() => {
    // Once the Home hand-off binds its draft directory, the conversation's
    // restored workspace becomes authoritative and the transient draft can go.
    if (workspacePath) pendingWorkspacePathRef.current = null;
  }, [workspacePath]);
  // Hidden file-input ref + onChange handler are owned by
  // `useComposerAttachments` — see `fileInputProps` below.
  /** Composer instance — exposes focus/select via ComposerHandle.
   *  Auto-grow is owned by the Composer component itself. */
  const composerRef = useRef<ComposerHandle | null>(null);
  // Verbose-state accumulator + chunk buffer + RAF flush machinery now
  // live in `useStreamBuffer` (see destructure of `stream` below). The
  // refs that used to live here were lifted out so a single hook owns
  // both the storage and the API.
  /**
   * Promise plumbing so `runChatTurn` can `await` a stream that runs in the
   * service worker. Resolved by the terminal port event for this sessionId;
   * left empty when the panel reopens to an already-running stream (no local
   * `runChatTurn` is waiting on it in that case).
   */
  const pendingTurnRef = useRef<{
    sessionId: string;
    resolve: () => void;
    reject: (e: Error) => void;
  } | null>(null);
  /**
   * Survive-tab-switch cache for the user message of each in-flight
   * turn. `runChatTurn` writes here before `client.submit` (the moment
   * we know the local-only `userMsg` exists); the terminal-event
   * handlers clear it. `handleSnapshot` on a switch-back-during-stream
   * uses this to re-insert the user bubble when `loadMessages` raced
   * the gateway's persistence and came back without it.
   *
   * Without this cache, the symptom is: send a message → switch to a
   * different session → switch back before the stream finishes →
   * **user bubble vanishes** until a hard refresh (because `saveMessages`
   * is a no-op by design — the gateway is the persistence authority —
   * but `loadMessages` reads from the gateway and the user-message DB
   * write hasn't landed yet). The cache scopes by sessionId so multiple
   * in-flight sessions don't trample each other.
   */
  const inFlightTurnByIdRef = useRef<
    Map<string, { user: UiMessage; assistantUiId: string }>
  >(new Map());
  const agentBySessionRef = useRef<Map<string, AgentExecutionContext>>(
    new Map(),
  );
  // Pending-turn queue, per-session persistence, send/stop/sendNow/
  // edit/cancel/remove + the two pre-emption refs all live in
  // `usePendingQueue` — see destructure below `runChatTurn`. The hook
  // is configured later because it depends on `runChatTurn` (which
  // depends on `stream.prime`, sessions, capabilities, etc.) and on
  // `stream.markCurrentAssistantStopped` / `rejectPendingTurn`.
  // Streaming buffer + flush + verbose-timeline machinery. Owns the
  // chunk/verbose refs and the two RAFs that batch them into React
  // state updates. The wire subscription (`client.onStreamEvent`)
  // stays in this file with the event router below — the router calls
  // `stream.onChunk` / `onReasoning` / etc. per event.
  const stream = useStreamBuffer({ sessions });

  // Approval flow (state, banner round-trip, per-message record stamps)
  // is owned by `useApprovals` — see internal/useApprovals.ts. We pass
  // the streaming-side hooks it needs (current assistant uiId, timeline
  // append, verbose flush) as callbacks from `stream`.
  const approvals = useApprovals({
    client,
    sessions,
    getCurrentAssistantUiId: stream.getCurrentAssistantUiId,
    appendApprovalToTimeline: stream.onApprovalToTimeline,
    scheduleVerboseFlush: stream.scheduleVerboseFlush,
  });
  const {
    pendingApprovals,
    setPendingApprovals,
    approvalInFlight,
    approvalError,
    setApprovalError,
    activeRunId,
    setActiveRunId,
    appendApprovalRecord,
    markApprovalOutcome,
    respondToApproval,
    onApprovalRequestEvent,
    onApprovalResolvedEvent,
    reset: resetApprovals,
  } = approvals;
  const conversationFrameRef = useRef<HTMLDivElement | null>(null);
  const conversationViewportRef = useRef<HTMLDivElement | null>(null);
  const conversationContentRef = useRef<HTMLDivElement | null>(null);
  const composerDockRef = useRef<HTMLElement | null>(null);
  const composerDockHeightRef = useRef(0);
  const keepConversationPinnedAfterDockResizeRef = useRef(false);
  const [composerDockHeight, setComposerDockHeight] = useState(0);
  // The chunk-buffer / RAF-flush machinery used to live inline here; now
  // owned by `useStreamBuffer` (`stream.*`).

  // The composer is a floating dock over the full-height conversation rather
  // than a flex sibling that removes an invisible, full-width band from the
  // message viewport. Mirror the dock's live height into the scroll content's
  // bottom clearance so the final message can always scroll completely above
  // the composer and a pending approval, no matter how tall either becomes.
  // Empty floating shells can also consume the same measurement to grow their
  // visible card around multiline drafts without remounting the Composer.
  useLayoutEffect(() => {
    if (!hasActive && !onComposerHeightChange) {
      composerDockHeightRef.current = 0;
      setComposerDockHeight(0);
      return;
    }

    const dock = composerDockRef.current;
    if (!dock) return;

    const updateDockHeight = () => {
      const nextHeight = measureComposerDockTargetHeight(dock);
      onComposerHeightChange?.(nextHeight);

      if (!hasActive) {
        composerDockHeightRef.current = 0;
        setComposerDockHeight(0);
        return;
      }
      if (nextHeight === composerDockHeightRef.current) return;

      const viewport = conversationViewportRef.current;
      if (viewport) {
        const distanceFromBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        keepConversationPinnedAfterDockResizeRef.current =
          distanceFromBottom <= 24;
      }

      composerDockHeightRef.current = nextHeight;
      setComposerDockHeight(nextHeight);
    };

    updateDockHeight();
    const observer = new ResizeObserver(updateDockHeight);
    observer.observe(dock);
    const editor = dock.querySelector<HTMLElement>("[data-auto-grow-editor]");
    const targetObserver = editor
      ? new MutationObserver(updateDockHeight)
      : null;
    targetObserver?.observe(editor!, {
      attributes: true,
      attributeFilter: ["data-auto-grow-target-height"],
    });
    return () => {
      observer.disconnect();
      targetObserver?.disconnect();
    };
  }, [hasActive, onComposerHeightChange]);

  useLayoutEffect(() => {
    if (!keepConversationPinnedAfterDockResizeRef.current) return;
    const viewport = conversationViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    keepConversationPinnedAfterDockResizeRef.current = false;
  }, [composerDockHeight]);

  // Pending-turn queue. `runChatTurn` is referenced by the hook for
  // sendNow / drainHead / send; it's a function declaration further
  // down in this component body, so JS hoisting makes the forward
  // reference safe (the value resolves at call time, not capture time).
  const queueHook = usePendingQueue({
    sessions,
    client,
    input,
    setInput,
    attachments,
    setAttachments,
    setAttachmentError,
    attachmentUploading,
    navigateOpenPolicy,
    setNavigateOpenPolicy,
    setPendingSourceApp,
    busy,
    markCurrentAssistantStopped: () => markCurrentAssistantStopped(),
    rejectPendingTurn: (sid, err) => rejectPendingTurn(sid, err),
    pageContextCapability: capabilities.pageContext,
    runChatTurn: (args: RunChatTurnArgs) => runChatTurn(args),
  });
  const {
    queue: pendingQueue,
    paused: queuePaused,
    editingQueueId,
    queuePausedRef,
    suppressFinallyDrainRef,
    ignoreAbortForSessionRef,
    setQueue: setPendingQueue,
    setPaused: setQueuePaused,
    setEditingQueueId,
    send,
    stop,
    sendNow: sendQueueItemNow,
    edit: editPendingQueueItem,
    cancelEdit: cancelQueueEdit,
    remove: removePendingQueueItem,
  } = queueHook;

  // Pick up a prompt handed off from the new-tab Home launcher or from
  // an external surface (Quick-Ask Spotlight selection, Region Snip
  // screenshot, `amiba://...` URL, Unix socket inbox). Each surface
  // writes `{ text?, attachments?, sourceApp? }` into storage and opens
  // the chat view; we drain that key here, prefill the composer with
  // whichever fields are populated, and flag the turn for auto-send.
  // We clear the storage key immediately so re-mounts (SW restart,
  // panel reopen) don't resubmit the same prompt.
  useEffect(() => {
    const drain = capabilities.pendingPrompt?.drain;
    if (!drain) return;
    // Re-runs whenever the active session id flips. Critical for the
    // home-composer hand-off and programmatic fresh-session requests can
    // change the active id while a pending prompt is being written. Re-run
    // on that transition so whichever operation finishes last still gets a
    // chance to drain the payload.
    //
    // No `cancelled` cleanup flag: `drain()` is destructive (read +
    // remove), so a value returned from an in-flight drain that races
    // with a deps change (typical of the home hand-off, where activeId
    // flips while the storage write for pendingPrompt is still in
    // flight) is *already gone from storage* — bailing here on
    // cancellation would silently drop the user's prompt. The payload
    // is session-agnostic; whichever effect run wins should still seed
    // the composer.
    void drain().then((raw) => {
      if (raw == null) return;
      const payload: PendingPromptResult =
        typeof raw === "string" ? { text: raw } : raw;
      const text = payload.text?.trim() ?? "";
      const incoming = payload.attachments ?? [];
      const promotedAttachments: Attachment[] = incoming.map((a) => ({
        uiId: a.uiId,
        name: a.name,
        mime: a.mime,
        size: a.size,
        kind: a.kind,
        path: a.path,
        thumbDataUrl: a.thumbDataUrl,
        textPreview: a.textPreview,
        // External hand-offs have already settled their bytes on disk —
        // never mark them as uploading; the composer formatter requires
        // `path && !uploading` to include them in the next turn.
      }));
      if (!text && promotedAttachments.length === 0) return;
      // Tag the composer with "from <App>" when the snip/quick-ask
      // hand-off named one. Visually a one-liner above the textarea —
      // dropped on next composer edit so it doesn't follow the user
      // around across unrelated turns.
      if (payload.sourceApp) setPendingSourceApp(payload.sourceApp);
      if (payload.workspacePath) {
        pendingWorkspacePathRef.current = payload.workspacePath;
      }
      if (payload.agent) {
        setDraftAgent(normalizeAgentContext(payload.agent));
      }
      if (text) setInput(text);
      if (promotedAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...promotedAttachments]);
      }
      // Auto-send only when there's actual text to anchor the turn.
      // Attachment-only hand-offs (a snip with no OCR) need user input
      // — auto-sending an empty user message is a footgun.
      if (text) setPendingAutosend(true);
    });
  }, [sessions.activeId, capabilities.pendingPrompt, pendingPromptTick]);

  // Subscribe to pending-prompt push events so the drain re-fires when
  // a new payload lands mid-session — covers the case where the
  // empty-state home composer submits into an already-active session
  // (activeId doesn't flip, so the activeId-based drain miss it).
  useEffect(() => {
    const sub = capabilities.pendingPrompt?.subscribe;
    if (!sub) return;
    return sub(() => setPendingPromptTick((t) => t + 1));
  }, [capabilities.pendingPrompt]);

  // `send` is defined later in this component (it depends on many
  // closures); keep a ref so the auto-send effect can fire the latest
  // version without needing `send` in its dependency array.
  const sendRef = useRef<(() => Promise<void>) | null>(null);

  // Once the panel is fully wired (sessions loaded, not in the middle of
  // another turn, port presumably connected), drain the pending auto-send
  // flag and submit the prefilled prompt. We gate on `input` being
  // non-empty so the React state from the read-on-mount effect above has
  // landed before send() sees a stale empty string.
  useEffect(() => {
    if (!pendingAutosend) return;
    if (!sessions.ready || busy) return;
    if (!input.trim()) return;
    setPendingAutosend(false);
    const fn = sendRef.current;
    if (fn) void fn();
  }, [pendingAutosend, sessions.ready, busy, input]);

  // -------------------------------------------------------------------------
  // Chat port: subscribe/snapshot/event handling.
  //
  // The agent loop lives in the service worker. The panel posts user input
  // and receives `StreamEvent`s back over a long-lived port. Snapshot is the
  // recovery path — sent on `subscribe` so a freshly mounted panel (or one
  // switching to a session that was streaming in another tab) can rebuild
  // the in-flight assistant bubble from accumulated runtime state.
  //
  // The accumulator/flush/timeline helpers used to live here as inline
  // function declarations; they're now on `stream.*` (see
  // `useStreamBuffer`). The handlers below call `stream.onChunk`,
  // `stream.onReasoning`, etc.
  // -------------------------------------------------------------------------

  function handleSnapshot(frame: SnapshotFrame): void {
    const { sessionId, kind } = frame;
    if (sessionId !== sessions.activeId) return;

    if (kind === "absent") {
      // SW has no record of this session. Two situations land here:
      //   1. User switched to a fresh / never-submitted session
      //      → panel-level state must drop so the composer reflects
      //        the new session.
      //   2. A subscribe-snapshot round-trip raced ahead of our own
      //      `submit` (typical of the new-tab → chat handoff). The
      //      SW will produce real state imminently and emit `begin`,
      //      so suppress hygiene here to avoid a busy/UI flicker.
      // `pendingTurnRef` is set the instant runChatTurn posts submit,
      // so it's the authoritative "we're mid-submission" signal.
      if (pendingTurnRef.current?.sessionId === sessionId) return;
      setBusy(false);
      resetApprovals();
      return;
    }

    // Live / interrupted / completed — SW state carries information
    // the panel may not yet have in ``prev`` (the messages loaded from
    // SessionDB). The three kinds have different invariants:
    //
    //   - "completed": SessionDB has the FULL final assistant turn
    //     (api_server commits before the stream resolves). ``prev``
    //     already contains it. The engine's in-memory runtime
    //     ``assistantUiId`` is its own ephemeral id (``shortId("a")``)
    //     which never matches the ``hermes:<row>`` ids ``loadMessages``
    //     produces — synthesizing would APPEND a duplicate bubble
    //     ("agent 回复重复一次" report). The only thing we still need
    //     from the snapshot is panel-only UI metadata
    //     (``agentFinalUrl`` / ``agentFinalTitle``) that doesn't
    //     round-trip through SessionDB — overlay onto the last
    //     assistant message instead.
    //   - "live": stream is still in flight. Panel may have closed
    //     before api_server committed the assistant placeholder, so
    //     synthesis IS the right thing — there's nothing in ``prev``
    //     to update yet.
    //   - "interrupted": engine crashed mid-stream. SessionDB has
    //     whatever api_server managed to write before the failure;
    //     the engine's state has the (potentially longer) text it had
    //     accumulated locally. Overlay onto the matching bubble if
    //     present, else synthesize the partial text. The actionable
    //     ErrorBlock below is the sole runtime-error indicator: encoding
    //     another `[interrupted]` marker into transient message content
    //     made the label jump to the latest turn after a reload.
    const { state } = frame;
    stream.hydrateFromSnapshot(state);
    setBusy(state.streaming);
    setPendingApprovals(state.pendingApprovals ?? []);
    setActiveRunId(state.runId ?? null);

    if (kind === "completed") {
      // No content rewrite — SessionDB is authoritative for completed
      // turns. Only re-attach the chip metadata that lives outside
      // SessionDB onto the last assistant message.
      if (state.agentFinalUrl) {
        sessions.setActiveMessages((prev) => {
          const arr = prev as UiMessage[];
          let lastAssistantIdx = -1;
          for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].role === "assistant") {
              lastAssistantIdx = i;
              break;
            }
          }
          if (lastAssistantIdx < 0) return arr;
          const cur = arr[lastAssistantIdx];
          if (
            cur.agentFinalUrl === state.agentFinalUrl &&
            cur.agentFinalTitle === (state.agentFinalTitle ?? undefined)
          ) {
            return arr;
          }
          const next = arr.slice();
          next[lastAssistantIdx] = {
            ...cur,
            agentFinalUrl: state.agentFinalUrl ?? undefined,
            agentFinalTitle: state.agentFinalTitle ?? undefined,
          };
          return next;
        });
      }
      return;
    }

    sessions.setActiveMessages((prev) => {
      const arr = prev as UiMessage[];
      const merged: Partial<UiMessage> = {
        content: state.assistantText,
        streaming: state.streaming,
        // Carry the chip URL the engine captured at end-of-turn through to
        // any panel that opens AFTER the stream finished. While the panel
        // is open, handleStreamDone writes this directly from the event
        // payload; this is just the cold-open fallback.
        ...(state.agentFinalUrl
          ? {
              agentFinalUrl: state.agentFinalUrl,
              agentFinalTitle: state.agentFinalTitle ?? undefined,
            }
          : {}),
      };
      const idx = arr.findIndex((m) => m.uiId === state.assistantUiId);
      if (idx >= 0) {
        const next = arr.slice();
        next[idx] = { ...next[idx], ...merged };
        return next;
      }
      // Cold-open mid-stream OR switch-back-during-stream: the panel
      // doesn't have a bubble matching ``state.assistantUiId`` yet.
      // Synthesize one so chunk/verbose flushes find it.
      const synthesized: UiMessage = {
        uiId: state.assistantUiId!,
        role: "assistant",
        content: "",
        ...merged,
      };
      // The matching user bubble normally comes from ``loadMessages``
      // (api_server persists user messages at request time). But
      // `loadMessages` is an HTTP read against the gateway; on a
      // switch-back-during-stream it can race the user-message DB
      // write and return without it, leaving the panel showing only
      // the assistant bubble (or nothing) until the next refresh.
      // Pull the user bubble out of `inFlightTurnByIdRef` — the cache
      // we populated in `runChatTurn` before posting — when the
      // snapshot's assistantUiId matches our cache entry AND ``prev``
      // doesn't already contain a user message with the same content
      // near the tail (loaded-from-gateway dedup).
      const cached = inFlightTurnByIdRef.current.get(sessionId);
      const cacheMatchesThisTurn =
        cached && cached.assistantUiId === state.assistantUiId;
      const tailUser = (() => {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].role === "user") return arr[i];
          if (arr[i].role === "assistant") break;
        }
        return null;
      })();
      const userAlreadyPresent =
        !!tailUser && !!cached && tailUser.content === cached.user.content;
      if (cacheMatchesThisTurn && !userAlreadyPresent) {
        return [...arr, cached.user, synthesized];
      }
      return [...arr, synthesized];
    });
    stream.applyVerboseToAssistant();
    if (kind === "interrupted" && state.error) {
      setError({
        message: state.error.message,
        status: state.error.status,
        hint: state.error.hint,
        source: "run",
      });
    }
  }

  function resolvePendingTurn(sessionId: string): void {
    const p = pendingTurnRef.current;
    if (p && p.sessionId === sessionId) {
      pendingTurnRef.current = null;
      p.resolve();
    }
    // Busy clearance is owned by the terminal-event handlers when the
    // session is active, or by `handleSnapshot` on the no-runtime path
    // — both of which the caller has already invoked. Touching busy
    // here would clobber the active session's flag when a background
    // session's terminal event arrives mid-stream of the foreground one.
  }

  function rejectPendingTurn(sessionId: string, err: Error): void {
    const p = pendingTurnRef.current;
    if (p && p.sessionId === sessionId) {
      pendingTurnRef.current = null;
      p.reject(err);
    }
  }

  function handleStreamDone(
    sessionId: string,
    agentFinalUrl?: string,
    agentFinalTitle?: string,
  ): void {
    if (sessionId !== sessions.activeId) {
      inFlightTurnByIdRef.current.delete(sessionId);
      resolvePendingTurn(sessionId);
      return;
    }
    stream.cancelStreamChunkFlush();
    stream.applyVerboseToAssistant();
    stream.cancelVerboseFlush();
    stream.flushStreamChunksToMessages();
    const assistantUiId = stream.getCurrentAssistantUiId() ?? null;
    stream.reset();
    if (assistantUiId) {
      sessions.setActiveMessages((prev) => {
        const next = (prev as UiMessage[]).map((m) =>
          m.uiId === assistantUiId
            ? {
                ...m,
                streaming: false,
                ...(agentFinalUrl ? { agentFinalUrl, agentFinalTitle } : {}),
              }
            : m,
        );
        void sessions.touchSession(sessionId, next);
        return next;
      });
    }
    // Force-persist the just-finished turn so a tab close / navigation
    // within the 250ms debounce window doesn't strand the messages in
    // memory only. Without this, the conversation looks empty when the
    // session is re-opened from another surface.
    void sessions.flushPersist();
    // Fire-and-forget LLM-generated title via the backplane. The endpoint
    // short-circuits when the session is already titled or beyond the
    // first-exchange window, so it's safe to call after every stream end.
    const profileId =
      agentBySessionRef.current.get(sessionId)?.profileId ??
      sessions.sessions.find((session) => session.id === sessionId)?.agent
        ?.profileId;
    void triggerHermesAutoTitle(sessionId, profileId)
      .then((res) => {
        if (res && "ok" in res && res.ok && res.title) {
          void sessions.applyAutoTitle(sessionId, res.title);
        }
      })
      .catch((e) => {
        console.warn("[sidepanel] auto-title trigger failed:", e);
      });
    setBusy(false);
    inFlightTurnByIdRef.current.delete(sessionId);
    resolvePendingTurn(sessionId);
  }

  /**
   * Seal whichever assistant message is currently streaming with the
   * `[stopped]` suffix, clear all the streaming-side refs, persist, and
   * flip `busy` off. Used by `handleStreamAborted` (SW echoed abort) AND
   * `sendQueueItemNow` (local pre-emption — we don't wait for the SW
   * echo to keep the queue feeling responsive). Idempotent: if there's
   * no streaming bubble to seal, this is a no-op apart from the busy
   * clearance.
   */
  function markCurrentAssistantStopped(): void {
    stream.cancelStreamChunkFlush();
    stream.applyVerboseToAssistant();
    stream.cancelVerboseFlush();
    stream.flushStreamChunksToMessages();
    const assistantUiId = stream.getCurrentAssistantUiId() ?? null;
    stream.reset();
    if (assistantUiId) {
      sessions.setActiveMessages((prev) =>
        (prev as UiMessage[]).map((m) =>
          m.uiId === assistantUiId
            ? {
                ...m,
                streaming: false,
                content: m.content + "\n\n[stopped]",
              }
            : m,
        ),
      );
    }
    // Same rationale as `handleStreamDone`: persist the aborted state
    // immediately so the `[stopped]` tail actually reaches storage.
    void sessions.flushPersist();
    setBusy(false);
    if (sessions.activeId) {
      inFlightTurnByIdRef.current.delete(sessions.activeId);
    }
  }

  function handleStreamAborted(sessionId: string): void {
    // `sendQueueItemNow` already sealed the previous turn locally AND
    // fired the next one. The pendingTurnRef now points at the *new*
    // turn — rejecting it (or re-running the seal logic) would either
    // cancel what the user just sent or stamp `[stopped]` onto the
    // wrong bubble. So bail completely on the echoed abort.
    if (ignoreAbortForSessionRef.current === sessionId) {
      ignoreAbortForSessionRef.current = null;
      return;
    }
    if (sessionId !== sessions.activeId) {
      // Background-session abort. We don't own this session's
      // visible bubble, but we do still own its in-flight cache entry
      // — drop it so a future switch back doesn't re-insert a stale
      // user bubble for a turn that's already over.
      inFlightTurnByIdRef.current.delete(sessionId);
      rejectPendingTurn(sessionId, new DOMException("aborted", "AbortError"));
      return;
    }
    markCurrentAssistantStopped();
    rejectPendingTurn(sessionId, new DOMException("aborted", "AbortError"));
  }

  function handleStreamError(
    sessionId: string,
    event: Extract<StreamEvent, { kind: "error" }>,
  ): void {
    if (sessionId !== sessions.activeId) {
      inFlightTurnByIdRef.current.delete(sessionId);
      rejectPendingTurn(sessionId, new Error(event.message));
      return;
    }
    const assistantUiId = stream.getCurrentAssistantUiId() ?? null;
    stream.reset();
    setPendingQueue((pq) => {
      for (const q of pq) {
        for (const a of q.attachments) void deleteAttachmentFile(a);
      }
      return [];
    });
    // Errors wipe the queue, so the paused flag (if any) is meaningless now.
    setQueuePaused(false);
    resetApprovals();
    setError({
      message: event.message,
      status: event.status,
      hint: event.hint,
      source: "run",
    });
    if (assistantUiId) {
      sessions.setActiveMessages((prev) =>
        (prev as UiMessage[]).filter((m) => m.uiId !== assistantUiId),
      );
    }
    setBusy(false);
    inFlightTurnByIdRef.current.delete(sessionId);
    rejectPendingTurn(sessionId, new Error(event.message));
  }

  function handleStreamEvent(sessionId: string, event: StreamEvent): void {
    if (sessionId !== sessions.activeId) {
      // Terminal events for non-active sessions still need to settle the
      // local awaiter (if any) — otherwise `runChatTurn` for a backgrounded
      // tab would never resolve.
      if (event.kind === "done")
        handleStreamDone(sessionId, event.agentFinalUrl, event.agentFinalTitle);
      else if (event.kind === "aborted") handleStreamAborted(sessionId);
      else if (event.kind === "error") handleStreamError(sessionId, event);
      return;
    }
    switch (event.kind) {
      case "begin":
        setBusy(true);
        workspacePane.beginTurn();
        stream.onBegin(event.assistantUiId);
        break;
      case "chunk":
        stream.onChunk(event.text);
        break;
      case "reasoning":
        stream.onReasoning(event.text);
        break;
      case "toolCalls":
        stream.onToolCalls(event.calls);
        break;
      case "hermesToolProgress":
        stream.onHermesToolProgress(event.event);
        workspacePane.observeToolEvent(event.event);
        break;
      case "session":
        if (event.sessionId && event.sessionId !== sessionId) {
          console.warn(
            "[sidepanel] gateway returned session id %s but we expected %s; ignoring.",
            event.sessionId,
            sessionId,
          );
        }
        break;
      case "run":
        setActiveRunId(event.runId || null);
        break;
      case "approvalRequest":
        onApprovalRequestEvent(event.request);
        break;
      case "approvalResolved":
        onApprovalResolvedEvent(event.approvalId);
        break;
      case "done":
        handleStreamDone(sessionId, event.agentFinalUrl, event.agentFinalTitle);
        break;
      case "aborted":
        handleStreamAborted(sessionId);
        break;
      case "error":
        handleStreamError(sessionId, event);
        break;
    }
  }

  // The dispatch handlers close over the current render's `sessions`, so we
  // keep the latest functions in refs and install single stable listeners
  // that delegate through them; sidesteps the add/remove race that swapping
  // listeners on every activeId change would create.
  const snapshotHandlerRef = useRef<(snap: SnapshotFrame) => void>(() => {});
  const streamHandlerRef = useRef<
    (sessionId: string, event: StreamEvent) => void
  >(() => {});
  useEffect(() => {
    snapshotHandlerRef.current = handleSnapshot;
    streamHandlerRef.current = handleStreamEvent;
  });

  // Single subscription to the engine — replaces chrome.runtime.connect port
  // wiring. Extension's ChromeChatEngineClient wraps a `chrome.runtime.Port`;
  // desktop's ElectronChatEngineClient wraps IPC; the surface here is the
  // same.
  useEffect(() => {
    const unsubSnap = client.onSnapshot((frame) =>
      snapshotHandlerRef.current(frame),
    );
    const unsubEvt = client.onStreamEvent((sessionId, event) =>
      streamHandlerRef.current(sessionId, event),
    );
    return () => {
      unsubSnap();
      unsubEvt();
    };
  }, [client]);

  // (Re)subscribe whenever the active tab flips. The engine dedupes
  // subscriptions; calling subscribe also re-delivers a snapshot, which is
  // how we recover an in-flight stream when the user switches back to a tab
  // that was streaming in the background.
  useEffect(() => {
    if (!sessions.ready || !sessions.activeId) return;
    client.subscribe(sessions.activeId);
  }, [client, sessions.ready, sessions.activeId]);

  // Auto-grow for the textarea now lives inside <Composer />. The
  // local effect that used to run here was duplicated logic — the
  // shared component takes care of it on every value/maxTextareaPx
  // change.

  // Learn-mode handlers (start / stopAndAttach), state (recording /
  // eventCount / stopBusy), and the engine-status subscription are now
  // owned by `useLearnMode` above — see internal/useLearnMode.ts.

  // navigate-open-policy: extension's Options page can mutate the policy;
  // capability surfaces those mutations so the side-panel state stays in sync.
  useEffect(() => {
    if (!capabilities.navigateOpenPolicy) return;
    return capabilities.navigateOpenPolicy.onChange((p) =>
      setNavigateOpenPolicy(p),
    );
  }, [capabilities.navigateOpenPolicy]);

  // Load chat-config on mount and watch for changes from the Options page so
  // the side panel always reflects the latest gateway alias. The actual
  // inference model is selected independently from the composer picker.
  useEffect(() => {
    void (async () => {
      const storage = getPlatform().storage;
      const r = await storage.get([
        SETTINGS_KEYS.model,
        SETTINGS_KEYS.navigateOpenPolicy,
      ]);
      const storedNavPolicy = r[SETTINGS_KEYS.navigateOpenPolicy];
      const legacyRun = (
        await storage.get("settings.sidepanel.runModeDefault")
      )["settings.sidepanel.runModeDefault"] as string | undefined;
      let navPol: NavigateOpenPolicy =
        storedNavPolicy === "agent" ||
        storedNavPolicy === "user_new_tab" ||
        storedNavPolicy === "user_same_tab"
          ? (storedNavPolicy as NavigateOpenPolicy)
          : "auto";
      if (
        storedNavPolicy === undefined &&
        (legacyRun === "user" || legacyRun === "agent")
      ) {
        navPol = legacyRun === "user" ? "user_same_tab" : "agent";
      }
      setNavigateOpenPolicy(navPol);
      try {
        await capabilities.navigateOpenPolicy?.apply(navPol);
      } catch {
        // Capability may not be wired (desktop) — that's fine, browser-tool
        // routing only matters in the extension.
      }
      setConfig({
        model:
          typeof r[SETTINGS_KEYS.model] === "string"
            ? (r[SETTINGS_KEYS.model] as string)
            : DEFAULT_HERMES_MODEL,
      });
    })();

    const unsub = getPlatform().storage.watch(
      [SETTINGS_KEYS.model],
      (changes: StorageChangeMap) => {
        setConfig((prev) => ({
          model:
            typeof changes[SETTINGS_KEYS.model]?.newValue === "string"
              ? (changes[SETTINGS_KEYS.model]!.newValue as string)
              : prev.model,
        }));
      },
    );
    return unsub;
  }, [capabilities.navigateOpenPolicy]);

  // Lifecycle of an assistant bubble is owned by the SW snapshot.
  // `handleSnapshot` dispatches on a tagged `kind` (absent / live /
  // interrupted / completed) — see `SnapshotFrame` in
  // background/chat/types.ts. The panel no longer infers anything from
  // `m.streaming` itself: that flag is volatile (see
  // lib/sessions/store.ts), set only as an in-memory hint between
  // `runChatTurn` appending the bubble and the SW's first event, and
  // re-derived from the snapshot for any pre-existing in-flight stream.

  // Auto-scroll on new content.
  useEffect(() => {
    const viewport = conversationViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [sessions.activeMessages]);

  // Session switch: drop panel-local stream accumulators and compose-time
  // affordances (pinned pages, attachments). The previous session's stream
  // keeps running in the SW; switching back to that session will
  // re-subscribe and rebuild local state from the snapshot.
  //
  // Note we do NOT delete the outgoing session's queued attachments here:
  // the queue is persisted per-session (see effects below) and the
  // attachments belong to it. They get cleaned up when their queue item
  // fires (consumed by runChatTurn) or is explicitly removed by the user.
  const lastSeenActiveRef = useRef<string>("");
  useEffect(() => {
    if (sessions.activeId !== lastSeenActiveRef.current) {
      const wasInitialised = lastSeenActiveRef.current !== "";
      lastSeenActiveRef.current = sessions.activeId;
      stream.reset();
      // An id-less surface can never own a live turn. Terminal events from
      // the conversation we just left are intentionally handled as
      // background events, so they cannot be relied on to clear Composer's
      // busy/stop state after New chat.
      if (!sessions.activeId) setBusy(false);
      if (wasInitialised) {
        // Drop in-memory queue; the load-effect below will repopulate
        // from the new session's persisted queue.
        setPendingQueue([]);
        // Queue is scoped to a session; switching tabs drops it, so
        // any paused flag for the prior session must drop too.
        setQueuePaused(false);
        // Pending approvals are also session-scoped — clear them on
        // switch; the new session's snapshot will repopulate if it has
        // its own pending approvals.
        resetApprovals();
        // The top-level recovery card belongs to the outgoing session.
        // The incoming snapshot will restore its own error, if any.
        setError(null);
        setPageError(null);
        // Same fire-and-forget GC as `newChat` — the composer-time
        // attachments belonged to the session we're leaving.
        for (const a of attachments) void deleteAttachmentFile(a);
        setAttachments([]);
        setAttachmentError(null);
        // The "from <App>" source hint belongs to the hand-off prompt
        // for THIS session; dropping it on switch keeps it from
        // bleeding into an unrelated chat.
        setPendingSourceApp(null);
        setWorkspaceError(null);
      }
    }
  }, [sessions.activeId]);

  // Per-session pendingQueue persistence (load on activate, save on
  // change, hydration-guarded) is owned by `usePendingQueue`.

  async function runChatTurn(args: {
    text: string;
    attachments: Attachment[];
    navigateOpenPolicyForTurn: NavigateOpenPolicy;
    /**
     * Frozen view of "the page the user was looking at when they sent".
     * Replayed verbatim to the agent so multi-step tools see the same
     * tab for the whole turn, even after the user navigates away. May be
     * undefined on desktop or when the capability declines to snapshot.
     */
    turnMetadataForTurn?: TurnMetadata;
  }): Promise<void> {
    const {
      text,
      attachments: attachmentsForTurn,
      navigateOpenPolicyForTurn,
      turnMetadataForTurn,
    } = args;

    setError(null);
    setPageError(null);

    const sessionAgent = sessions.sessions.find(
      (session) => session.id === sessions.activeId,
    )?.agent;
    const agentForTurn = normalizeAgentContext(sessionAgent ?? draftAgent);
    const sessionId = sessions.activeId
      ? sessions.activeId
      : await sessions.createNew(agentForTurn);
    if (!sessionAgent) {
      await sessions.setAgentContext(sessionId, agentForTurn);
    }
    agentBySessionRef.current.set(sessionId, agentForTurn);

    const pendingWorkspacePath = pendingWorkspacePathRef.current;
    let workspaceForTurn = workspacePath ?? undefined;
    const workspaces = getPlatform().workspaces;
    if (pendingWorkspacePath) {
      if (workspaces) {
        try {
          await workspaces.bind(sessionId, pendingWorkspacePath);
          workspaceForTurn = pendingWorkspacePath;
          pendingWorkspacePathRef.current = null;
          setWorkspaceError(null);
        } catch (e) {
          const message = String((e as Error)?.message || e);
          setWorkspaceError(message);
          // The send path has already consumed the composer values. Restore
          // them so the user can choose another directory and retry without
          // losing the prompt or its attachments.
          setInput(text);
          setAttachments(attachmentsForTurn);
          return;
        }
      } else {
        pendingWorkspacePathRef.current = null;
      }
    }

    // A desktop task never has an undefined cwd. During the first send the
    // active-session workspace hook can still be crossing the IPC boundary,
    // so resolve it synchronously here before constructing the persisted user
    // message or starting Hermes. Unbound sessions resolve to Amiba's $HOME
    // default in the desktop workspace adapter.
    if (!workspaceForTurn && workspaces) {
      try {
        workspaceForTurn =
          (await workspaces.getCurrent(sessionId)) ?? undefined;
        if (!workspaceForTurn) {
          throw new Error("The default workspace root is unavailable.");
        }
        setWorkspaceError(null);
      } catch (e) {
        const message = String((e as Error)?.message || e);
        setWorkspaceError(message);
        setInput(text);
        setAttachments(attachmentsForTurn);
        return;
      }
    }

    // Every attachment — image, text, pdf, binary — is inlined into the
    // user message content as a plain-text `<file-attachment>` block.
    // The agent reads the file by path with whatever tools it has; we
    // don't use OpenAI multimodal parts and we don't emit a separate
    // system-role message — wire shape stays `{role:"user", content:str}`.
    const attachmentsForSend = attachmentsForTurn.filter(
      (a) => a.path && !a.uploading,
    );
    const fileAttachmentBlock =
      attachmentsForSend.length > 0
        ? formatFileAttachmentsForPrompt(attachmentsForSend)
        : "";
    // Build the persisted-on-bubble badges in parallel with the request:
    // images need a small thumbnail re-encode which is non-trivial, so we
    // kick that off but don't block the send path on it.
    const badgesPromise: Promise<AttachmentBadge[] | undefined> =
      attachmentsForSend.length > 0
        ? Promise.all(attachmentsForSend.map(attachmentToBadge))
        : Promise.resolve(undefined);

    const userMsg: UiMessage = {
      uiId: shortId("u"),
      role: "user",
      content: text,
      ...(workspaceForTurn ? { workspacePath: workspaceForTurn } : {}),
    };
    const assistantMsg: UiMessage = {
      uiId: shortId("a"),
      role: "assistant",
      content: "",
      streaming: true,
    };

    sessions.setActiveMessages((prev) => {
      const next = [...prev, userMsg, assistantMsg];
      void sessions.touchSession(sessionId, next);
      return next;
    });
    // Cache the (userMsg, assistantUiId) pair so a tab-switch-and-back
    // during the stream can re-insert the user bubble if loadMessages
    // beat the gateway's persistence write. Cleared by the terminal
    // event handlers (done / aborted / error).
    inFlightTurnByIdRef.current.set(sessionId, {
      user: userMsg,
      assistantUiId: assistantMsg.uiId,
    });
    // Persist immediately so a refresh between bubble-append and the
    // first SW echo doesn't lose the user message. The standard
    // `schedulePersistMessages` debounce is 250ms — long enough for a
    // quick reload after send-now to miss it.
    void sessions.flushPersist();
    // Once the user message is in the log, attach the (async-built)
    // badges in a follow-up update so the chips render as soon as the
    // thumbnails are ready.
    void badgesPromise.then((attachmentBadges) => {
      if (!attachmentBadges) return;
      sessions.setActiveMessages((prev) => {
        const next = (prev as UiMessage[]).map((m) =>
          m.uiId === userMsg.uiId ? { ...m, attachmentBadges } : m,
        );
        void sessions.touchSession(sessionId, next);
        return next;
      });
    });
    setBusy(true);

    // Push runTarget from Open policy *before* the gateway may dispatch tools.
    // No-op when navigateOpenPolicy capability is absent (desktop).
    try {
      await capabilities.navigateOpenPolicy?.apply(navigateOpenPolicyForTurn);
    } catch (e) {
      console.warn("[sidepanel] navigateOpenPolicy apply failed:", e);
    }

    // Snapshot the history we're sending so we don't accidentally include
    // the empty assistant placeholder we just appended.
    const baseMessages = (sessions.activeMessages as UiMessage[]).map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }));
    // Inline page-context and file-attachment blocks into the final user
    // message content. Context first, user's typed question last — the
    // model focuses on the most recent tokens, so the actual question
    // staying at the tail keeps instruction-following clean. The version
    // saved on `userMsg` (rendered in the bubble) stays as the raw typed
    // text; only the wire copy carries the inlined blocks.
    const wireUserContent = [fileAttachmentBlock, userMsg.content]
      .filter((s) => s && s.length > 0)
      .join("\n\n");
    const history: ChatMessage[] = [
      ...baseMessages,
      {
        role: userMsg.role,
        content: wireUserContent,
      },
    ];

    // Prime the panel-local accumulators BEFORE submitting so the port
    // event listener (which fires asynchronously once the SW broadcasts
    // back) finds populated state to mutate. The SW also maintains its
    // own copy for snapshot-on-resubscribe; the two are kept in sync by
    // applying every event on both sides.
    stream.prime(assistantMsg.uiId);

    try {
      await new Promise<void>((resolve, reject) => {
        pendingTurnRef.current = { sessionId, resolve, reject };
        try {
          client.submit({
            sessionId,
            sessionTitle: sessions.sessions.find(
              (session) => session.id === sessionId,
            )?.title,
            assistantUiId: assistantMsg.uiId,
            model: config.model,
            history,
            agent: agentForTurn,
            turnMetadata: turnMetadataForTurn,
          });
        } catch (e) {
          pendingTurnRef.current = null;
          reject(e as Error);
        }
      });
    } catch (e) {
      // The terminal-event handlers (handleStreamAborted /
      // handleStreamError) have already applied the visible UI changes —
      // marking the bubble [stopped], surfacing the error banner, etc.
      // We only log non-abort failures here for debugging.
      const err = e as Error;
      if (err.name !== "AbortError") {
        console.warn("[sidepanel] stream failed:", err.message);
      }
    } finally {
      // Busy clearance is owned by the terminal-event handlers (so a
      // background session's `done` doesn't clobber the active session's
      // busy state). Do NOT touch busy here.
      // If `sendQueueItemNow` already fired the next turn directly (it
      // does this when the user clicked send-now during busy), skip the
      // drain here — otherwise we'd kick off a second concurrent
      // runChatTurn that races the one already running.
      if (suppressFinallyDrainRef.current) {
        suppressFinallyDrainRef.current = false;
      } else if (!queuePausedRef.current) {
        // If the user hit Stop, the queue was deliberately frozen — don't
        // re-fire it until they explicitly resume. Otherwise drain the head.
        setPendingQueue((prev) => {
          if (prev.length === 0) return prev;
          const [head, ...tail] = prev;
          queueMicrotask(
            () =>
              void runChatTurn({
                text: head.text,
                attachments: head.attachments,
                navigateOpenPolicyForTurn: head.navigateOpenPolicySnapshot,
                turnMetadataForTurn: head.turnMetadataSnapshot,
              }),
          );
          return tail;
        });
      }
    }
  }

  // The queue actions (send / stop / sendNow / edit / cancelEdit /
  // remove / drainHead) and the per-session persistence effects all
  // live in `usePendingQueue` — destructured above as `queueHook`.
  // `sendRef` is still here because the auto-send useEffect wants to
  // call the latest `send` closure without listing it as a dep.
  sendRef.current = send;

  /**
   * Append (or refresh) the persistent approval record on whichever
   * assistant message is currently streaming. Idempotent: re-emits of
   * the same approval (e.g. gateway retry, panel reopen during a still-
   * pending approval) overwrite the existing record rather than
   * stacking duplicates. Skipped silently when there's no active
   * assistant message — the gateway shouldn't fire an approval outside
   * a turn, but we don't want to crash if it does.
   */
  // Approval-flow helpers (appendApprovalRecord / markApprovalOutcome /
  // respondToApproval) and the per-card in-flight tracker now live in
  // `useApprovals` — see destructure near the top of the component.

  async function handleNavigateOpenPolicyChange(next: NavigateOpenPolicy) {
    setNavigateOpenPolicy(next);
    await getPlatform().storage.set({
      [SETTINGS_KEYS.navigateOpenPolicy]: next,
    });
    // Both the broadcast to other surfaces (SW / Options page) and the
    // runTarget application live in the navigateOpenPolicy capability. When
    // absent (desktop) the policy state still tracks but doesn't affect any
    // browser-tools routing because there are none.
    try {
      await capabilities.navigateOpenPolicy?.apply(next);
    } catch (e) {
      console.warn("[sidepanel] navigateOpenPolicy apply failed:", e);
    }
  }

  async function newChat() {
    const sid = sessions.activeId;

    // New chat is one atomic UI boundary. Settle the outgoing turn locally
    // before the async abort/deselect work so the persistent Quick Ask
    // Composer cannot carry its stop button or streaming buffer into Home.
    // If this renderer owns the pending promise, gate its finally block before
    // rejecting it; otherwise that old turn could drain its queued follow-up
    // after the user has already asked for a blank conversation.
    if (sid && pendingTurnRef.current?.sessionId === sid) {
      suppressFinallyDrainRef.current = true;
      rejectPendingTurn(sid, new DOMException("aborted", "AbortError"));
    }
    markCurrentAssistantStopped();
    setError(null);
    setPageError(null);
    setInput("");
    setPendingAutosend(false);
    setPendingSourceApp(null);
    // The persisted queue still belongs to the outgoing session; only its
    // in-memory projection is cleared so it cannot flash inside the empty
    // persistent Composer while the session transition finishes.
    setPendingQueue([]);
    setEditingQueueId(null);
    setQueuePaused(false);
    resetApprovals();
    // Drop any composer-time attachments and unlink their on-disk files —
    // they were tied to the old session and won't be referenced again.
    for (const a of attachments) void deleteAttachmentFile(a);
    setAttachments([]);
    setAttachmentError(null);
    pendingWorkspacePathRef.current = null;
    setWorkspaceError(null);
    if (sid) {
      try {
        client.abort(sid);
      } catch (e) {
        console.warn("[sidepanel] abort failed:", e);
      }
    }
    await sessions.deselect();
  }

  useEffect(() => {
    if (
      handledNewConversationRequestRef.current === newConversationRequestKey
    ) {
      return;
    }
    handledNewConversationRequestRef.current = newConversationRequestKey;
    void newChat();
  }, [newConversationRequestKey]);

  // `addFiles`, `removeAttachment`, `openFilePicker`, `handleComposerPaste`
  // all live in `useComposerAttachments` — destructured up-top. The
  // shared hook is the single source of truth for attachment ingestion
  // across ChatSurface, HomeView, and the Quick-Ask popup; touching
  // any of those flows now means editing one file, not three.

  const messages = sessions.activeMessages as UiMessage[];
  const showTurnRail =
    variant === "fullscreen" &&
    messages.some((message) => message.role === "user");
  // The home/empty state is identified solely by the absence of a session
  // id. A persisted session with zero messages is still a real conversation
  // and therefore uses the normal chat layout.
  const isComposerOnlyEmpty = emptyState === "composer-only" && !hasActive;
  const persistComposerHost =
    persistComposerAcrossModes && emptyState === "composer-only";
  const composerDockInEmptyHost = persistComposerHost && isComposerOnlyEmpty;
  const showComposerDock = shouldMountComposerDock(
    hasActive,
    isComposerOnlyEmpty,
    persistComposerHost,
  );

  // When a host gives the composer-only surface an explicit height, make the
  // body fill that column and pin the Composer to its bottom. The flag is
  // host geometry, not conversation or modal state, so the Composer keeps one
  // containing block across compact and multiline drafts.
  const expandComposerArea = !isComposerOnlyEmpty || composerOnlyExpanded;

  // Read-only mode: the active session originates from another channel
  // (Feishu, Telegram, …) that owns the writing engine. We render the
  // history but replace the composer with a notice; sending here would
  // race that engine because amiba has no outbound delivery path
  // back to those platforms.
  const activeSession = hasActive
    ? sessions.sessions.find((s) => s.id === sessions.activeId)
    : undefined;
  const readOnlyRemote =
    !!activeSession && !isLocalChannel(activeSession.source);
  const remoteChannelLabel = (() => {
    if (!readOnlyRemote || !activeSession) return "";
    const d = resolveChannel(activeSession.source);
    const translated = t(d.labelKey as MessageKey);
    return translated === d.labelKey ? d.fallbackLabel : translated;
  })();

  // Voice input — wired into Composer's `microphone` prop. The recorder
  // hook owns the MediaRecorder lifecycle; once the user toggles stop we
  // POST the blob to /v1/stt and either append the transcript to `input`
  // (default) or fire `send()` immediately (`autoSend` pref).
  const voicePrefs = useVoicePrefs();
  const voiceRecorder = useVoiceRecorder({
    deviceId: voicePrefs.deviceId || undefined,
  });
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const handleVoiceToggle = useCallback(() => {
    if (voiceTranscribing) return;
    if (!voiceRecorder.recording) {
      void voiceRecorder.start().catch((e) => {
        const message = String((e as Error)?.message || e);
        setError({
          message:
            message === "Permission denied"
              ? t("composer.voice.permissionDenied")
              : t("composer.voice.transcribeFailed", { error: message }),
          source: "voice",
        });
      });
      return;
    }
    setVoiceTranscribing(true);
    void (async () => {
      try {
        const blob = await voiceRecorder.stop();
        if (!blob || blob.size === 0) return;
        const result = await transcribeAudio(blob);
        if (result.ok !== true) {
          // ``in`` narrows reliably even under the extension app's
          // non-strict tsconfig where discriminated unions don't.
          const message = "error" in result ? result.error : "unknown";
          setError({
            message: t("composer.voice.transcribeFailed", { error: message }),
            source: "voice",
          });
          return;
        }
        const transcript = result.text.trim();
        if (!transcript) return;
        setInput((prev) => {
          if (!prev) return transcript;
          // Add a space only when the existing buffer doesn't already
          // end with whitespace, so users who appended mid-edit don't
          // get double spaces.
          return /\s$/.test(prev) ? prev + transcript : prev + " " + transcript;
        });
        if (voicePrefs.autoSend) {
          // Defer one tick so the setInput state lands before send reads it.
          setTimeout(() => {
            sendRef.current?.().catch(() => {
              /* surfaced via the normal send error path */
            });
          }, 0);
        }
      } catch (e) {
        setError({
          message: t("composer.voice.transcribeFailed", {
            error: String((e as Error)?.message || e),
          }),
          source: "voice",
        });
      } finally {
        setVoiceTranscribing(false);
      }
    })();
  }, [voiceRecorder, voiceTranscribing, voicePrefs.autoSend, t]);

  // Composer JSX shared by the bottom dock and the legacy centred empty
  // state. Most hosts still choose one branch or the other; Quick Ask opts
  // into the persistent dock path so React keeps this exact subtree mounted
  // while the first session is created or New chat returns to empty.
  const composerNode = (
    <Composer
      ref={composerRef}
      value={input}
      onChange={setInput}
      onSubmit={(t) => void send(t)}
      busy={busy}
      onAbort={stop}
      autoFocus={composerAutoFocus}
      canSubmit={
        (input.trim().length > 0 ||
          attachments.some((a) => a.path && !a.uploading)) &&
        !attachmentUploading &&
        !attachmentBusy
      }
      contextRail={
        pendingSourceApp || pendingQueue.length > 0 ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {pendingSourceApp && (
              <div
                className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[11px] text-muted-foreground"
                title={`Selection captured from ${pendingSourceApp}`}
              >
                <span className="shrink-0">{t("sidepanel.context.from")}</span>
                <span className="max-w-32 truncate font-medium text-foreground/85">
                  {pendingSourceApp}
                </span>
                <button
                  type="button"
                  onClick={() => setPendingSourceApp(null)}
                  className="ml-0.5 shrink-0 rounded-md p-1 text-muted-foreground/65 transition-colors hover:bg-background/70 hover:text-foreground"
                  aria-label={t("sidepanel.context.dismissSource")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <PendingQueueRail
              items={pendingQueue.map((item) => ({
                queueId: item.queueId,
                preview: previewPendingTurn(item),
              }))}
              editingQueueId={editingQueueId}
              onSendNow={sendQueueItemNow}
              onEdit={editPendingQueueItem}
              onRemove={removePendingQueueItem}
            />
          </div>
        ) : undefined
      }
      placeholder={
        attachmentUploading
          ? t("sidepanel.placeholder.uploading")
          : attachments.length > 0
            ? t("sidepanel.placeholder.withAttachments")
            : t("sidepanel.placeholder")
      }
      sendTitle={t("sidepanel.send.tooltip")}
      sendQueueTitle={t("sidepanel.queue.tooltip")}
      stopTitle={t("sidepanel.stop")}
      kbdHints={[
        { keys: "⏎", label: t("sidepanel.composer.kbd.send") },
        { keys: "⇧⏎", label: t("sidepanel.composer.kbd.newline") },
      ]}
      modelPicker
      approvalModePicker
      topAffordance={
        editingQueueId != null ? (
          <div className="flex items-center gap-1 px-2 pt-1 text-[10px] text-muted-foreground/70">
            <Pencil className="h-2.5 w-2.5" />
            <span>{t("sidepanel.queue.edit.aria")}</span>
            <button
              type="button"
              onClick={cancelQueueEdit}
              title={t("sidepanel.composer.cancelEdit")}
              className="rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("sidepanel.composer.cancelEdit.aria")}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ) : undefined
      }
      attachments={att}
      microphone={
        voicePrefs.enabled
          ? {
              recording: voiceRecorder.recording,
              transcribing: voiceTranscribing,
              onToggle: handleVoiceToggle,
            }
          : undefined
      }
      mentionProviders={mentionProviders}
      agentPicker={{
        value: effectiveAgent,
        profileLocked,
        onChange: (next) => {
          const normalized = normalizeAgentContext(next);
          if (
            profileLocked &&
            normalized.profileId !== effectiveAgent.profileId
          ) {
            return;
          }
          setDraftAgent(normalized);
          if (sessions.activeId) {
            void sessions.setAgentContext(sessions.activeId, normalized);
          }
        },
      }}
      frameClassName={composerFrameClassName}
      density={composerDensity}
      pickerDialogSize={composerPickerDialogSize}
      pickerOverlayVariant={composerPickerOverlayVariant}
      pickerRefreshKey={composerPickerRefreshKey}
      chipRow={undefined}
      actionsLeft={
        hasActive
          ? slots?.navigateOpenPolicyToggle?.({
              policy: navigateOpenPolicy,
              onChange: (next) => void handleNavigateOpenPolicyChange(next),
            })
          : undefined
      }
    />
  );

  // Read-only notice — shown instead of ``composerNode`` when the
  // active session originates from a non-local channel. Single-line,
  // no actions: amiba has no outbound path to deliver a reply back
  // to Feishu / Telegram / etc., so we don't pretend the composer is
  // safe to use here. Users continue the conversation on the
  // originating platform.
  const readOnlyNoticeNode = readOnlyRemote ? (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
      <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {t("sidepanel.sessions.readOnlyNotice", { name: remoteChannelLabel })}
      </span>
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "relative flex flex-col bg-background text-foreground",
        // sidebar variant takes the full viewport; fullscreen variant
        // is mounted inside a flex column and consumes the remaining
        // space (the host already places a top-bar sibling above us, so
        // `h-full` would overflow by the bar's height and spill a page-
        // level scrollbar — `flex-1 min-h-0` makes us share the column
        // honestly).
        //
        // ``composer-only`` empty state is content-sized so a host like
        // the Quick-Ask popup can shrink its window to the composer's
        // natural height; without this it'd collapse to zero because
        // the popup body has no explicit height in compact mode.
        variant === "fullscreen"
          ? expandComposerArea
            ? "min-h-0 flex-1"
            : ""
          : "h-screen",
        surfaceClassName,
      )}
    >
      {variant === "sidebar" && (
        <TabBar
          tabs={sessions.openTabs}
          activeId={sessions.activeId}
          onActivate={(id) => void sessions.switchToTab(id)}
          onClose={(id) => void sessions.closeTab(id)}
          onCloseMany={(ids) => void sessions.closeTabs(ids)}
          onNew={() => void newChat()}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenSettings={() => openSettings()}
        />
      )}

      {/*
        `pt-2` reserves a fixed 8px strip of `bg-background` between the
        TabBar and the scrollable chat area. Because the gap lives OUTSIDE
        the ScrollArea it never scrolls, so a sticky user bubble (which
        pins to the ScrollArea's viewport top) lands a few pixels below
        the tabs instead of butting up against them.
      */}
      <div
        ref={conversationFrameRef}
        className={cn(
          "relative flex min-h-0 min-w-0 flex-col",
          isComposerOnlyEmpty ? "overflow-visible" : "overflow-hidden",
          // ``flex-1`` makes this body region fill the rest of the column
          // in the normal "hero" / populated paths. Quick-Ask's
          // composer-only empty mode opts out so the wrapper sizes to the
          // composer's natural height (a flex-1 child inside a content-
          // sized parent would collapse to 0 and hide the composer).
          expandComposerArea && "flex-1",
        )}
      >
        <div
          className={cn(
            "relative flex min-h-0 min-w-0 flex-col",
            isComposerOnlyEmpty ? "overflow-visible" : "overflow-hidden",
            isComposerOnlyEmpty && composerDensity === "compact"
              ? "pt-0"
              : "pt-2",
            expandComposerArea && "flex-1",
            // The message column is constrained independently from the
            // panel-level turn rail. This keeps the rail pinned to the
            // panel's left edge while the conversation stays centered.
            variant === "fullscreen" &&
              MESSAGES_MAX_WIDTH_CLASS[messagesMaxWidth],
          )}
        >
          {!hasActive ? (
            isComposerOnlyEmpty ? (
              persistComposerHost ? null : (
                // Quick-Ask compact mode: skip the hero entirely and let
                // the composer flow at its natural height. Hosts that opt into
                // persistence render this same Composer in the stable dock
                // below instead, so it survives the first-session boundary.
                <div
                  className={cn(
                    "flex flex-col px-2",
                    composerDensity === "compact" ? "pb-1" : "pb-2",
                    composerOnlyExpanded && "h-full justify-end",
                  )}
                >
                  {pendingSourceApp && (
                    <div className="app-drag-region mb-1 flex shrink-0 items-center gap-1 px-1 text-[11px] text-muted-foreground">
                      <span>{t("quickAsk.selectionFrom")}</span>
                      <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                        {pendingSourceApp}
                      </span>
                    </div>
                  )}
                  {readOnlyNoticeNode ?? composerNode}
                </div>
              )
            ) : slots?.emptyState ? (
              // Host-provided empty state (desktop hands in
              // ``<HomeView panelMode />`` so the home composer surface
              // becomes the "no chat selected" view verbatim). This branch is
              // intentionally keyed only to `activeId`: existing empty
              // sessions remain normal conversation views.
              // The slot owns its own layout; we just hand it a sized
              // parent.
              <div className="absolute inset-0">{slots.emptyState}</div>
            ) : (
              // Built-in fallback: home-style centred composer with a
              // greeting above, reusing the chat ``composerNode`` so
              // submission creates a session via ``ensureActive`` and
              // the conversation continues seamlessly.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8">
                <div className="space-y-1 text-center">
                  <AmibaLogo size={56} />
                  <p className="pt-2 text-sm font-semibold">
                    {t("newtab.greeting")}
                  </p>
                  <p className="max-w-[40ch] text-xs text-muted-foreground">
                    {t("newtab.subtitle")}
                  </p>
                </div>
                <div
                  className={cn(
                    "w-full",
                    variant === "fullscreen" ? "max-w-2xl" : "max-w-md",
                  )}
                >
                  {readOnlyNoticeNode ?? composerNode}
                </div>
                {error && (
                  <ErrorBlock error={error} onOpenSettings={openSettings} />
                )}
              </div>
            )
          ) : (
            <ScrollArea
              data-conversation-scroll-region
              className="min-h-0 min-w-0 flex-1"
              viewportRef={conversationViewportRef}
              hideScrollbar={showTurnRail}
            >
              <div
                ref={conversationContentRef}
                data-selection="text"
                className="min-w-0 space-y-2 p-3"
                style={{
                  paddingBottom:
                    composerDockHeight > 0
                      ? `${composerDockHeight + 12}px`
                      : undefined,
                }}
              >
                <MessageTurns
                  messages={messages}
                  onOpenAgentDestination={openAgentDestination}
                />

                {error && (
                  <ErrorBlock error={error} onOpenSettings={openSettings} />
                )}
              </div>
            </ScrollArea>
          )}
        </div>
        {hasActive && showTurnRail && (
          <ConversationTurnRail
            messages={messages}
            viewportRef={conversationViewportRef}
            contentRef={conversationContentRef}
            containerRef={conversationFrameRef}
          />
        )}
      </div>

      {/* A persistent composer-only host keeps this exact bottom-anchored
          footer mounted on both sides of the first-session boundary. The
          shell may change its chrome, but the Composer never changes owner. */}
      {showComposerDock && (
        <footer
          ref={composerDockRef}
          className={cn(
            // The sticky user-question strip inside the scroll viewport is
            // z-20. Composer popovers live inside the composer's own z-10
            // stacking context, so their local z-index cannot outrank that
            // strip unless the floating dock itself participates above the
            // message layer. Keeping the dock absolutely positioned also
            // lets the conversation viewport continue behind its side
            // gutters instead of losing a full-width white band.
            composerDockInEmptyHost
              ? "absolute inset-x-0 bottom-0 z-30 isolate px-2"
              : "amiba-composer-dock absolute inset-x-0 bottom-0 z-30 isolate p-2",
            // Composer always gets a fixed cap in fullscreen — a wide
            // input line is uncomfortable to type into regardless of how
            // wide the user set the message column above.
            variant === "fullscreen" &&
              !composerDockInEmptyHost &&
              "mx-auto w-full max-w-3xl",
          )}
        >
          {/*
          Bridge/connection pill is extension-only — provided via the
          `bridgeBar` slot. Desktop omits and the row is hidden.
        */}
          {hasActive ? slots?.bridgeBar : null}
          {hasActive &&
            (pageError || attachmentError || workspaceError) && (
            <div className="mb-1 flex flex-col gap-1">
              {pageError && (
                <div className="flex items-start justify-between gap-2 rounded border border-amber-400/50 bg-amber-50/40 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  <span className="min-w-0 flex-1 break-words">
                    {pageError}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPageError(null)}
                    className="shrink-0 rounded p-0.5 hover:bg-amber-500/10"
                    aria-label="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {attachmentError && (
                <div className="flex items-start justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                  <span className="min-w-0 flex-1 break-words">
                    {attachmentError}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachmentError(null)}
                    className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
                    aria-label="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {workspaceError && (
                <div className="flex items-start justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                  <span className="min-w-0 flex-1 break-words">
                    {workspaceError}
                  </span>
                  <button
                    type="button"
                    onClick={() => setWorkspaceError(null)}
                    className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
                    aria-label="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}
          {hasActive && capabilities.learn && (
            <div className="mb-1 flex shrink-0 flex-wrap items-center gap-1">
              {!learnRecording ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px]"
                  disabled={attachmentUploading}
                  title={t("sidepanel.learn.tooltip")}
                  onClick={() => void startLearnFromPanel()}
                >
                  <Disc className="h-3 w-3 shrink-0" />
                  {t("sidepanel.learn.record")}
                </Button>
              ) : (
                <>
                  <span className="max-w-[10rem] truncate text-[11px] text-muted-foreground">
                    {t("sidepanel.learn.recording", { count: learnEventCount })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={learnStopBusy || attachmentUploading}
                    onClick={() => void stopLearnToComposer()}
                  >
                    {learnStopBusy
                      ? t("sidepanel.learn.processing")
                      : t("sidepanel.learn.stop")}
                  </Button>
                </>
              )}
            </div>
          )}
          {/* Approval state remains a blocking banner. Queue entries now share the
          composer's context rail with its immutable workspace tab. */}
          <div
            className={cn(
              "relative flex w-full flex-col",
              att.dragOver && "rounded-lg ring-2 ring-primary/30",
            )}
          >
            {hasActive && pendingApprovals.length > 0 && (
              <ApprovalBanner
                approvals={pendingApprovals}
                inFlight={approvalInFlight}
                error={approvalError}
                onRespond={respondToApproval}
                onDismissError={() => setApprovalError(null)}
              />
            )}
            {readOnlyNoticeNode ?? composerNode}
            {/* Drop overlay is rendered by Composer (via attachments
            prop) — no need to duplicate it here. */}
          </div>
        </footer>
      )}

      <SessionDrawer
        open={historyOpen}
        sessions={sessions.sessions}
        openTabIds={sessions.openTabIds}
        activeId={sessions.activeId}
        onClose={() => setHistoryOpen(false)}
        onOpen={(id) => {
          // Toggle: picking the already-active row deselects, landing
          // the chat surface on the empty/home state. Same semantics
          // as ``FullScreenChatView``'s rail rows.
          if (id === sessions.activeId) {
            void sessions.deselect();
          } else {
            void sessions.openTab(id);
          }
        }}
        onRename={(id, title) => void sessions.rename(id, title)}
        onDelete={(id) => {
          // Clean up the per-session persisted queue alongside the
          // session itself. Best-effort: storage failures here only
          // cost a stale key, they don't affect session deletion.
          void getPlatform().storage.remove(pendingQueueStorageKey(id));
          void sessions.remove(id);
        }}
        onOpenCronSession={onOpenCronSession}
        onRefresh={() => void sessions.refresh()}
      />
    </div>
  );
}
