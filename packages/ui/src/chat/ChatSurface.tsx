import {
  Bot,
  Brain,
  ChevronDown,
  ChevronUp,
  Disc,
  Eye,
  Folder,
  FolderOpen,
  Globe,
  History,
  Loader2,
  MousePointerClick,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useT, type MessageKey, type TranslateFn } from "@hermes-x/i18n";
import { getPlatform, type StorageChangeMap } from "@hermes-x/platform";
import { useResolvedTheme } from "../theme";
import { Button, HermesLogo, ScrollArea } from "../primitives";
import { cn } from "../primitives";
import { shortId } from "@hermes-x/utils";
// Wire-protocol types + engine + helpers — everything that was previously
// imported from extension-local paths now lives in @hermes-x/core.
import {
  attachmentToBadge,
  classify,
  deleteAttachmentFile,
  formatBytesShort,
  formatFileAttachmentsForPrompt,
  isAttachmentReadOk,
  isLocalChannel,
  postHermesApprovalDecision,
  readBlobAsAttachment,
  resolveChannel,
  transcribeAudio,
  triggerHermesAutoTitle,
  useSessions,
  useVoicePrefs,
  DEFAULT_HERMES_MODEL,
  HERMES_APPROVAL_GATEWAY_TIMEOUT_MS,
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
} from "@hermes-x/core";

// Sub-components + helpers + UI types live next to this file in chat-ui.
import { ApprovalBanner } from "./bubble/approval";
import { ErrorBlock } from "./bubble/chips";
import { MessageTurns } from "./bubble/Bubble";
import { Composer, type ComposerHandle } from "./Composer";
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
import { PendingQueueRail } from "./internal/PendingQueueRail";
import { useApprovals } from "./internal/useApprovals";
import { useFolderDrop } from "./internal/useFolderDrop";
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
  /** When true, assistant bubbles show streamed tool-call + reasoning deltas. */
  showStreamDetails: "settings.chat.showStreamDetails",
  /** Where navigate opens + (when not Auto) where all browser tools run. */
  navigateOpenPolicy: "settings.sidepanel.navigateOpenPolicy",
};

// applyOpenPolicyToRunTarget moved into the extension wrapper as part of
// NavigateOpenPolicyCapability — chrome.runtime/windows/tabs all live there.

// UiMessage / AssistantTimelineItem / ChatError / COMPOSER_TEXTAREA_MAX_PX
// now live in @hermes-x/chat-ui (alongside the rendering components).
// Imported below in the consolidated import block.

// PendingChatTurn / previewPendingTurn / pendingQueueStorageKey now
// live in internal/usePendingQueue.ts (the queue subsystem owns its own
// types + helpers). Imported above.

// openAgentDestinationInUserWindow lives in the extension wrapper as a
// concrete chrome.windows + chrome.tabs implementation; ChatSurface
// receives it as the `openAgentDestination` prop.

// ChatError moved to @hermes-x/chat-ui (see consolidated import block).

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
 * narrow column). Re-exported from @hermes-x/chat-ui so external surfaces
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
   * Called when the TabBar gear icon is clicked. Extension uses
   * `openSettings()`; desktop opens a separate Options
   * BrowserWindow.
   */
  openSettings: () => void;

  /**
   * Open an agent-destination URL in the user's primary browser/window.
   * Extension impl uses chrome.windows + chrome.tabs; desktop uses
   * `shell.openExternal`.
   */
  openAgentDestination: (url: string) => void | Promise<void>;
}

export default function ChatSurface({
  variant = "sidebar",
  messagesMaxWidth = "comfortable",
  emptyState = "hero",
  composerAutoFocus = false,
  client,
  capabilities = {},
  slots,
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

  const [input, setInput] = useState("");
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
  /** Show streamed tool-call + reasoning blocks above assistant markdown. */
  const [showStreamDetails, setShowStreamDetails] = useState(false);
  const showStreamDetailsRef = useRef(false);
  /**
   * Guards the `showStreamDetails` write-back so it can't clobber the stored
   * value before the initial chrome.storage load resolves. Without this, the
   * effect runs at mount with `false`, races the async load, and persists
   * `false` on top of a user's `true`, making the toggle "forget" itself
   * every time the side panel reopens.
   */
  const showStreamDetailsLoadedRef = useRef(false);
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
  const att = useComposerAttachments({
    getSessionId: () =>
      sessions.ready ? sessions.ensureActive() : "default",
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
  // `dragOver` + `dropHandlers` are owned by `useComposerAttachments`
  // — see destructure above. The local state used to live here.
  // Workspace binding (desktop-only folder drop) is owned by
  // `useFolderDrop`; see internal/useFolderDrop.ts.
  const {
    workspacePath,
    workspaceError,
    setWorkspaceError,
    folderDragOver,
    dropHandlers: folderDropHandlers,
    unbindCurrent: unbindWorkspace,
  } = useFolderDrop({ sessions });
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The chunk-buffer / RAF-flush machinery used to live inline here; now
  // owned by `useStreamBuffer` (`stream.*`).

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
  // screenshot, `hermes-x://...` URL, Unix socket inbox). Each surface
  // writes `{ text?, attachments?, sourceApp? }` into storage and opens
  // the chat view; we drain that key here, prefill the composer with
  // whichever fields are populated, and flag the turn for auto-send.
  // We clear the storage key immediately so re-mounts (SW restart,
  // panel reopen) don't resubmit the same prompt.
  useEffect(() => {
    const drain = capabilities.pendingPrompt?.drain;
    if (!drain) return;
    // Re-runs whenever the active session id flips. Critical for the
    // home-composer hand-off: when the user submits from
    // ``<HomeView panelMode />`` in the empty state, that surface
    // calls ``sessions.createNew()`` and writes the typed text to
    // ``home.pendingPrompt``. The new active id propagates here via
    // storage sync; without this dep, the once-on-mount drain would
    // miss the freshly-written payload and the message would never
    // auto-send.
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
    //     present, else synthesize so the [interrupted] tail still
    //     reaches the user.
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
      const suffix = kind === "interrupted" ? "\n\n[interrupted]" : "";
      const merged: Partial<UiMessage> = {
        content: state.assistantText + suffix,
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
        !!tailUser &&
        !!cached &&
        tailUser.content === cached.user.content;
      if (cacheMatchesThisTurn && !userAlreadyPresent) {
        return [...arr, cached.user, synthesized];
      }
      return [...arr, synthesized];
    });
    stream.applyVerboseToAssistant();
    if (kind === "interrupted" && state.error) {
      setError({
        message: state.error.message,
        hint: state.error.hint,
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
                ...(agentFinalUrl
                  ? { agentFinalUrl, agentFinalTitle }
                  : {}),
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
    void triggerHermesAutoTitle(sessionId)
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
    setError({ message: event.message, hint: event.hint });
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
  const streamHandlerRef = useRef<(sessionId: string, event: StreamEvent) => void>(
    () => {}
  );
  useEffect(() => {
    snapshotHandlerRef.current = handleSnapshot;
    streamHandlerRef.current = handleStreamEvent;
  });

  // Single subscription to the engine — replaces chrome.runtime.connect port
  // wiring. Extension's ChromeChatEngineClient wraps a `chrome.runtime.Port`;
  // desktop's ElectronChatEngineClient wraps IPC; the surface here is the
  // same.
  useEffect(() => {
    const unsubSnap = client.onSnapshot((frame) => snapshotHandlerRef.current(frame));
    const unsubEvt = client.onStreamEvent((sessionId, event) =>
      streamHandlerRef.current(sessionId, event)
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
    return capabilities.navigateOpenPolicy.onChange((p) => setNavigateOpenPolicy(p));
  }, [capabilities.navigateOpenPolicy]);

  // Load chat-config on mount and watch for changes from the Options page so
  // the side panel always reflects the latest model selection. Storage goes
  // through the PlatformAdapter so the same code path works in extension
  // (chrome.storage.local) and desktop (Electron file store).
  useEffect(() => {
    void (async () => {
      const storage = getPlatform().storage;
      const r = await storage.get([
        SETTINGS_KEYS.model,
        SETTINGS_KEYS.navigateOpenPolicy,
        SETTINGS_KEYS.showStreamDetails,
      ]);
      if (typeof r[SETTINGS_KEYS.showStreamDetails] === "boolean") {
        setShowStreamDetails(r[SETTINGS_KEYS.showStreamDetails] as boolean);
      }
      showStreamDetailsLoadedRef.current = true;
      const storedNavPolicy = r[SETTINGS_KEYS.navigateOpenPolicy];
      const legacyRun = (await storage.get("settings.sidepanel.runModeDefault"))[
        "settings.sidepanel.runModeDefault"
      ] as string | undefined;
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
      [SETTINGS_KEYS.model, SETTINGS_KEYS.showStreamDetails],
      (changes: StorageChangeMap) => {
        setConfig((prev) => ({
          model:
            typeof changes[SETTINGS_KEYS.model]?.newValue === "string"
              ? (changes[SETTINGS_KEYS.model]!.newValue as string)
              : prev.model,
        }));
        if (typeof changes[SETTINGS_KEYS.showStreamDetails]?.newValue === "boolean") {
          setShowStreamDetails(
            changes[SETTINGS_KEYS.showStreamDetails]!.newValue as boolean,
          );
        }
      },
    );
    return unsub;
  }, [capabilities.navigateOpenPolicy]);

  useEffect(() => {
    showStreamDetailsRef.current = showStreamDetails;
  }, [showStreamDetails]);

  // -------------------------------------------------------------------------
  // Workspace binding (drop-a-folder-to-pin-it) lives in `useFolderDrop`
  // — see internal/useFolderDrop.ts. The hook owns the per-session
  // workspace-path subscription, the drag-target detection, and the
  // bind/unbind round-trips against `platform.workspaces`.

  useEffect(() => {
    if (!showStreamDetailsLoadedRef.current) return;
    void getPlatform().storage.set({
      [SETTINGS_KEYS.showStreamDetails]: showStreamDetails,
    });
  }, [showStreamDetails]);

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
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (el) (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
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

    const sessionId = await sessions.ensureActive();

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
            assistantUiId: assistantMsg.uiId,
            model: config.model,
            history,
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
          queueMicrotask(() =>
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
    setError(null);
    setPageError(null);
    // The old session's pendingQueue stays with the old session (we
    // persist it per-session). The switch-effect will swap in-memory
    // queue to the new session's [] on activeId change.
    setQueuePaused(false);
    resetApprovals();
    // Drop any composer-time attachments and unlink their on-disk files —
    // they were tied to the old session and won't be referenced again.
    for (const a of attachments) void deleteAttachmentFile(a);
    setAttachments([]);
    setAttachmentError(null);
    const sid = sessions.activeId;
    if (sid) {
      try {
        client.abort(sid);
      } catch (e) {
        console.warn("[sidepanel] abort failed:", e);
      }
    }
    await sessions.createNew();
  }

  // `addFiles`, `removeAttachment`, `openFilePicker`, `handleComposerPaste`
  // all live in `useComposerAttachments` — destructured up-top. The
  // shared hook is the single source of truth for attachment ingestion
  // across ChatSurface, HomeView, and the Quick-Ask popup; touching
  // any of those flows now means editing one file, not three.

  const messages = sessions.activeMessages as UiMessage[];
  const hasActive = !!sessions.activeId;
  // ``composer-only`` mode is active only while we'd otherwise render the
  // empty state. Once messages land we fall back to the normal populated
  // layout — Quick-Ask wants its expanded card to look exactly like the
  // desktop main window's right pane.
  const isComposerOnlyEmpty =
    emptyState === "composer-only" && (!hasActive || messages.length === 0);

  // Read-only mode: the active session originates from another channel
  // (Feishu, Telegram, …) that owns the writing engine. We render the
  // history but replace the composer with a notice; sending here would
  // race that engine because hermes-x has no outbound delivery path
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
        });
      } finally {
        setVoiceTranscribing(false);
      }
    })();
  }, [voiceRecorder, voiceTranscribing, voicePrefs.autoSend, t]);

  // Composer JSX captured once so we can mount it either in the bottom
  // footer (active chat) or in the centred empty state (no session yet).
  // React reconciles by position, so swapping branches remounts the
  // Composer — its input value lives in `input` (parent state) so the
  // user doesn't lose what they were typing across the transition.
  const composerNode = (
    <Composer
      ref={composerRef}
      value={input}
      onChange={setInput}
      onSubmit={() => void send()}
      busy={busy}
      onAbort={stop}
      autoFocus={composerAutoFocus}
      canSubmit={
        (input.trim().length > 0 ||
          attachments.some((a) => a.path && !a.uploading)) &&
        !attachmentUploading &&
        !attachmentBusy
      }
      // Quick-action chips are kept hidden in the normal sidebar/
      // fullscreen layouts (the composer footer is meant to be a
      // narrow input row). Quick-Ask's ``composer-only`` empty state
      // is the one surface that wants them back — they re-appear
      // exactly when the popup is sitting on a blank conversation.
      quickActions={isComposerOnlyEmpty}
      flatTop={pendingQueue.length > 0 || pendingApprovals.length > 0}
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
      chipRow={undefined}
      actionsLeft={
        hasActive ? (
          <>
            {slots?.navigateOpenPolicyToggle?.({
              policy: navigateOpenPolicy,
              onChange: (next) => void handleNavigateOpenPolicyChange(next),
            })}
            <button
              type="button"
              onClick={() => setShowStreamDetails((v) => !v)}
              aria-pressed={showStreamDetails}
              title={t("sidepanel.streamDetails.tooltip")}
              className={cn(
                "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                showStreamDetails
                  ? "border-foreground/20 bg-foreground/10 text-foreground hover:bg-foreground/15"
                  : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Brain className="h-3 w-3" />
              <span>{t("sidepanel.streamDetails")}</span>
            </button>
          </>
        ) : undefined
      }
    />
  );

  // Read-only notice — shown instead of ``composerNode`` when the
  // active session originates from a non-local channel. Single-line,
  // no actions: hermes-x has no outbound path to deliver a reply back
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
          ? isComposerOnlyEmpty
            ? ""
            : "min-h-0 flex-1"
          : "h-screen",
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
        className={cn(
          "relative min-w-0 overflow-hidden pt-2",
          // ``flex-1`` makes this body region fill the rest of the column
          // in the normal "hero" / populated paths. Quick-Ask's
          // composer-only empty mode opts out so the wrapper sizes to the
          // composer's natural height (a flex-1 child inside a content-
          // sized parent would collapse to 0 and hide the composer).
          !isComposerOnlyEmpty && "flex-1",
          // Only fullscreen variant honors the messages-width preset; the
          // sidebar variant is already a narrow column and shouldn't be
          // capped further. `full` evaluates to "" so messages span the
          // entire pane.
          variant === "fullscreen" && MESSAGES_MAX_WIDTH_CLASS[messagesMaxWidth],
          folderDragOver && "ring-2 ring-primary/40",
        )}
        ref={scrollRef}
        {...folderDropHandlers}
      >
        {!hasActive || messages.length === 0 ? (
          isComposerOnlyEmpty ? (
            // Quick-Ask compact mode: skip the hero entirely and let
            // the composer flow at its natural height. No
            // ``absolute inset-0`` here — the wrapper must size to the
            // composer so the host popup can shrink-wrap. The full
            // composer (attachments, voice, send) is preserved; only
            // the surrounding chrome (logo, greeting, queue list,
            // workspace chips) is dropped. The ``selection from <App>``
            // hint still renders here so a Spotlight-style selection
            // hand-off remains visible before the first turn.
            <div className="flex flex-col px-2 pb-2">
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
          ) : slots?.emptyState ? (
            // Host-provided empty state (desktop hands in
            // ``<HomeView panelMode />`` so the home composer surface
            // becomes the "no chat selected" view verbatim). Rendered
            // in both the "no session" case AND the "session exists
            // but no messages yet" case — the user gets the same
            // home-style composer regardless of whether they clicked
            // "new chat" first or just landed on the empty surface.
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
                <HermesLogo size={56} />
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
                <ErrorBlock
                  error={error}
                  onOpenSettings={() => openSettings()}
                />
              )}
            </div>
          )
        ) : (
          <ScrollArea className="h-full min-w-0">
            <div className="min-w-0 space-y-2 p-3">
              <MessageTurns
                messages={messages}
                showStreamDetails={showStreamDetails}
                onOpenAgentDestination={openAgentDestination}
              />

              {error && (
                <ErrorBlock
                  error={error}
                  onOpenSettings={() => openSettings()}
                />
              )}
            </div>
          </ScrollArea>
        )}
        {folderDragOver && (
          <div className="pointer-events-none absolute inset-0 z-[9] flex items-center justify-center bg-primary/10 text-[12px] font-medium text-primary">
            <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-background/95 px-3 py-2 shadow-sm">
              <FolderOpen className="h-4 w-4" />
              <span>Drop folder to bind workspace</span>
            </div>
          </div>
        )}
      </div>

      {/*
        Footer is skipped whenever the empty-state surface is showing
        (no session, or session with no messages yet) — the composer
        in that mode renders centred inside the empty-state block
        above, and the chat-only extras (errors, workspace chips,
        queue list, approvals) are irrelevant until the first turn
        lands.
      */}
      {hasActive && messages.length > 0 && (
      <footer
        className={cn(
          "p-2",
          // Composer always gets a fixed cap in fullscreen — a wide
          // input line is uncomfortable to type into regardless of how
          // wide the user set the message column above.
          variant === "fullscreen" && "mx-auto w-full max-w-3xl",
        )}
      >
        {/*
          Bridge/connection pill is extension-only — provided via the
          `bridgeBar` slot. Desktop omits and the row is hidden.
        */}
        {slots?.bridgeBar}
        {(pageError || attachmentError || workspaceError) && (
          <div className="mb-1 flex flex-col gap-1">
            {pageError && (
              <div className="flex items-start justify-between gap-2 rounded border border-amber-400/50 bg-amber-50/40 px-2 py-1 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <span className="min-w-0 flex-1 break-words">{pageError}</span>
                <button
                  type="button"
                  onClick={() => setPageError(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-amber-500/10"
                  aria-label="Dismiss">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {attachmentError && (
              <div className="flex items-start justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                <span className="min-w-0 flex-1 break-words">{attachmentError}</span>
                <button
                  type="button"
                  onClick={() => setAttachmentError(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
                  aria-label="Dismiss">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {workspaceError && (
              <div className="flex items-start justify-between gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                <span className="min-w-0 flex-1 break-words">{workspaceError}</span>
                <button
                  type="button"
                  onClick={() => setWorkspaceError(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
                  aria-label="Dismiss">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}
        {(workspacePath || pendingSourceApp) && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {workspacePath && (
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
                title={`Bound workspace for this session: ${workspacePath}`}>
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate" dir="rtl">
                  {workspacePath}
                </span>
                <button
                  type="button"
                  onClick={unbindWorkspace}
                  className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Unbind workspace">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {pendingSourceApp && (
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
                title={`Selection captured from ${pendingSourceApp}`}>
                <span className="text-muted-foreground">from</span>
                <span className="min-w-0 truncate">{pendingSourceApp}</span>
                <button
                  type="button"
                  onClick={() => setPendingSourceApp(null)}
                  className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Dismiss source hint">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
        )}
        {capabilities.learn && (
          <div className="mb-1 flex shrink-0 flex-wrap items-center gap-1">
            {!learnRecording ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                disabled={attachmentUploading}
                title={t("sidepanel.learn.tooltip")}
                onClick={() => void startLearnFromPanel()}>
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
                  onClick={() => void stopLearnToComposer()}>
                  {learnStopBusy
                    ? t("sidepanel.learn.processing")
                    : t("sidepanel.learn.stop")}
                </Button>
              </>
            )}
          </div>
        )}
        {/*
          Cursor-style composer: optional queued turns render in a slim strip
          *above* the bordered box (popup stack). The textarea + action row
          stay inside the rounded frame; focus-within still targets that box.
          The hidden file input + drop handlers + drop overlay live INSIDE
          Composer (via `attachments={att}`) — no need to render them here.
        */}
        <div
          className={cn(
            "relative flex w-full flex-col",
            att.dragOver && "rounded-lg ring-2 ring-primary/30",
          )}
        >
          {pendingApprovals.length > 0 && (
            <ApprovalBanner
              approvals={pendingApprovals}
              inFlight={approvalInFlight}
              error={approvalError}
              onRespond={respondToApproval}
              onDismissError={() => setApprovalError(null)}
            />
          )}
          <PendingQueueRail
            items={pendingQueue.map((item) => ({
              queueId: item.queueId,
              preview: previewPendingTurn(item),
            }))}
            editingQueueId={editingQueueId}
            composerDragOver={att.dragOver}
            onSendNow={sendQueueItemNow}
            onEdit={editPendingQueueItem}
            onRemove={removePendingQueueItem}
          />
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
