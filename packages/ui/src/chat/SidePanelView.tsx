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
  Send,
  Sparkles,
  Trash2,
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
  SidePanelCapabilities,
} from "./internal/capabilities";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      reject(new Error(`${label} (exceeded ${Math.round(ms / 1000)}s)`));
    }, ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

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

/** One user turn waiting while the model is still streaming the previous reply. */
interface PendingChatTurn {
  queueId: string;
  text: string;
  attachments: Attachment[];
  navigateOpenPolicySnapshot: NavigateOpenPolicy;
  /**
   * Browser-tab snapshot captured when the user pressed send (queued or
   * immediate). Replayed verbatim when the turn fires so the agent's
   * "current tab" tool sees the page the user was actually looking at,
   * not whatever they switched to afterwards. ``undefined`` for surfaces
   * without ``pageContext`` (desktop) or restricted pages.
   */
  turnMetadataSnapshot?: TurnMetadata;
}

// openAgentDestinationInUserWindow lives in the extension wrapper as a
// concrete chrome.windows + chrome.tabs implementation; SidePanelView
// receives it as the `openAgentDestination` prop.

function previewPendingTurn(t: PendingChatTurn): string {
  const parts: string[] = [];
  const body = t.text.trim();
  if (body) parts.push(body.length > 160 ? `${body.slice(0, 157)}…` : body);
  const n = t.attachments.filter((a) => a.path && !a.uploading).length;
  if (n > 0) parts.push(n === 1 ? "(1 attachment)" : `(${n} attachments)`);
  return parts.join(" ") || "(empty)";
}

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

export interface SidePanelViewProps {
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
   *    the *same* SidePanelView body as the desktop main window.
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
  capabilities?: SidePanelCapabilities;

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
     * toolbar. The toggle needs internal SidePanelView state (current
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

export default function SidePanelView({
  variant = "sidebar",
  messagesMaxWidth = "comfortable",
  emptyState = "hero",
  composerAutoFocus = false,
  client,
  capabilities = {},
  slots,
  openSettings,
  openAgentDestination,
}: SidePanelViewProps) {
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
  const [learnRecording, setLearnRecording] = useState(false);
  const [learnEventCount, setLearnEventCount] = useState(0);
  const [learnStopBusy, setLearnStopBusy] = useState(false);
  // `dragOver` + `dropHandlers` are owned by `useComposerAttachments`
  // — see destructure above. The local state used to live here.
  /**
   * Workspace binding for this surface. `null` when no directory is bound
   * or the platform doesn't expose a WorkspaceAdapter (extension). The chat
   * area renders a folder-drop overlay when `folderDragOver` is true; the
   * composer toolbar shows a path chip when `workspacePath` is non-null.
   */
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [folderDragOver, setFolderDragOver] = useState(false);
  // Hidden file-input ref + onChange handler are owned by
  // `useComposerAttachments` — see `fileInputProps` below.
  /** Composer instance — exposes focus/select via ComposerHandle.
   *  Auto-grow is owned by the Composer component itself. */
  const composerRef = useRef<ComposerHandle | null>(null);
  /**
   * Verbose-state accumulator for the currently active in-flight stream.
   * Mirrors the per-turn closure the old inline `streamChat` used, lifted to
   * component scope so port events (which fire outside any particular
   * `runChatTurn` invocation) can find it. Reset on activeId change and
   * rebuilt wholesale from the SW snapshot on (re)subscribe.
   */
  const verboseStateRef = useRef<{
    assistantUiId: string;
    reasoning: string;
    tools: StreamedToolCall[];
    hermesOrder: string[];
    hermesById: Map<string, HermesToolProgress>;
    timeline: AssistantTimelineItem[];
  } | null>(null);
  const verboseFlushRafRef = useRef<number | null>(null);
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
  /** FIFO: user turns composed while `busy`; shown above the composer and drained after each stream. */
  const [pendingQueue, setPendingQueue] = useState<PendingChatTurn[]>([]);
  /**
   * `true` after the user explicitly hits Stop with queued items present.
   * Freezes auto-drain so the next stream doesn't immediately re-trigger
   * the queue; user can review/edit/delete pending items first. Cleared
   * by Resume, a fresh Send, or New Chat.
   */
  const [queuePaused, setQueuePaused] = useState(false);
  const queuePausedRef = useRef(false);
  useEffect(() => {
    queuePausedRef.current = queuePaused;
  }, [queuePaused]);
  /**
   * When non-null, the composer mirrors a queue item's content for in-place
   * edit. The item stays in the queue (visually highlighted) and the queue
   * is paused while editing so nothing fires past it. Send saves the edit
   * AND fires that item immediately; cancel just clears the composer +
   * exits edit mode.
   */
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  /**
   * Active gateway approval requests for the current session. Mirrored
   * from the SW chat engine's runtime state (snapshot on subscribe + live
   * `approvalRequest`/`approvalResolved` events). Empty unless the agent
   * is blocked waiting for the user. Reset on session switch.
   */
  const [pendingApprovals, setPendingApprovals] = useState<
    HermesApprovalRequest[]
  >([]);
  /** Latest `X-Hermes-Run-Id` for the active session. Fallback when an approval event lacks its own runId. */
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  /** Per-approval state for the buttons: which decision is in-flight, if any. */
  const [approvalInFlight, setApprovalInFlight] = useState<
    Record<string, HermesApprovalDecision>
  >({});
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * Coalesce SSE `delta.content` strings into at most one React update per
   * animation frame. Token-at-a-time `setActiveMessages` forces Streamdown /
   * the whole tree to re-render hundreds of times per second and can wedge or
   * OOM the side panel on long replies.
   */
  const streamChunkBufRef = useRef<{
    assistantUiId: string;
    pending: string;
  } | null>(null);
  const streamFlushRafRef = useRef<number | null>(null);

  function cancelStreamChunkFlush(): void {
    if (streamFlushRafRef.current != null) {
      cancelAnimationFrame(streamFlushRafRef.current);
      streamFlushRafRef.current = null;
    }
  }

  function flushStreamChunksToMessages(): void {
    const slot = streamChunkBufRef.current;
    if (!slot || slot.pending.length === 0) return;
    const delta = slot.pending;
    slot.pending = "";
    const uiId = slot.assistantUiId;
    sessions.setActiveMessages((prev) => {
      const next = (prev as UiMessage[]).slice();
      const i = next.findIndex((m) => m.uiId === uiId);
      if (i >= 0) {
        next[i] = { ...next[i], content: next[i].content + delta };
      }
      return next;
    });
  }

  function scheduleStreamChunkFlush(): void {
    if (streamFlushRafRef.current != null) return;
    streamFlushRafRef.current = requestAnimationFrame(() => {
      streamFlushRafRef.current = null;
      flushStreamChunksToMessages();
      if (streamChunkBufRef.current?.pending) {
        scheduleStreamChunkFlush();
      }
    });
  }

  useEffect(() => {
    return () => {
      cancelStreamChunkFlush();
    };
  }, []);

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

  function appendTextToVerboseTimeline(delta: string): void {
    const v = verboseStateRef.current;
    if (!v) return;
    const last = v.timeline[v.timeline.length - 1];
    if (last && last.kind === "text") {
      last.text += delta;
    } else {
      v.timeline.push({ kind: "text", id: shortId("tl"), text: delta });
    }
  }

  function appendToolToVerboseTimeline(toolCallId: string): void {
    const v = verboseStateRef.current;
    if (!v) return;
    const seen = v.timeline.some(
      (it) => it.kind === "tool" && it.toolCallId === toolCallId,
    );
    if (seen) return;
    v.timeline.push({ kind: "tool", id: shortId("tl"), toolCallId });
  }

  function appendApprovalToVerboseTimeline(approvalId: string): void {
    const v = verboseStateRef.current;
    if (!v) return;
    const seen = v.timeline.some(
      (it) => it.kind === "approval" && it.approvalId === approvalId,
    );
    if (seen) return;
    v.timeline.push({
      kind: "approval",
      id: shortId("tl"),
      approvalId,
    });
  }

  function cancelVerboseFlush(): void {
    if (verboseFlushRafRef.current != null) {
      cancelAnimationFrame(verboseFlushRafRef.current);
      verboseFlushRafRef.current = null;
    }
  }

  function applyVerboseToAssistant(): void {
    const v = verboseStateRef.current;
    if (!v) return;
    // Reasoning rides on its own field so the bubble renderer can chip it
    // separately from the body text. ``streamVerbose`` now carries only
    // the tool-args markdown (still hidden behind the dev verbose toggle).
    const rs = v.reasoning.trimEnd();
    const parts: string[] = [];
    const named = v.tools.filter((t) => t.name);
    if (named.length > 0) {
      const blocks = named.map((t) => {
        const args = (t.arguments || "").trimEnd();
        return `**${t.name}**${args ? `\n\n\`\`\`json\n${args}\n\`\`\`` : ""}`;
      });
      parts.push(blocks.join("\n\n"));
    }
    const md = parts.join("\n\n");
    const progress = v.hermesOrder
      .map((id) => v.hermesById.get(id))
      .filter((ev): ev is HermesToolProgress => Boolean(ev));
    // Snapshot the timeline so React sees a new identity for each text item
    // when its content grows (text items are mutated in place during the run).
    const timelineSnapshot = v.timeline.map((it) =>
      it.kind === "text" ? { ...it } : it,
    );
    const assistantUiId = v.assistantUiId;
    sessions.setActiveMessages((prev) =>
      (prev as UiMessage[]).map((m) =>
        m.uiId === assistantUiId
          ? {
              ...m,
              streamVerbose: md,
              reasoning: rs || undefined,
              hermesToolProgress: progress,
              assistantTimeline: timelineSnapshot,
            }
          : m,
      ),
    );
  }

  function scheduleVerboseFlush(): void {
    if (verboseFlushRafRef.current != null) return;
    verboseFlushRafRef.current = requestAnimationFrame(() => {
      verboseFlushRafRef.current = null;
      applyVerboseToAssistant();
    });
  }

  // -------------------------------------------------------------------------
  // Chat port: subscribe/snapshot/event handling.
  //
  // The agent loop lives in the service worker. The panel posts user input
  // and receives `StreamEvent`s back over a long-lived port. Snapshot is the
  // recovery path — sent on `subscribe` so a freshly mounted panel (or one
  // switching to a session that was streaming in another tab) can rebuild
  // the in-flight assistant bubble from accumulated runtime state.
  // -------------------------------------------------------------------------

  function resetLiveStreamState(): void {
    cancelStreamChunkFlush();
    cancelVerboseFlush();
    streamChunkBufRef.current = null;
    verboseStateRef.current = null;
  }

  function hydrateLocalFromSnapshot(state: ChatRuntimeState): void {
    if (!state.assistantUiId) return;
    verboseStateRef.current = {
      assistantUiId: state.assistantUiId,
      reasoning: state.reasoning,
      tools: state.toolCalls.slice(),
      hermesOrder: state.hermesOrder.slice(),
      hermesById: new Map(
        state.hermesToolProgress.map((e: HermesToolProgress) => [e.toolCallId, e]),
      ),
      // Copy text items so the in-place `last.text += delta` mutations
      // from future chunk events don't retroactively rewrite history.
      timeline: state.timeline.map((it: AssistantTimelineItem) =>
        it.kind === "text" ? { ...it } : { ...it },
      ),
    };
    if (state.streaming) {
      // The accumulator buffers later deltas on top of the snapshot's
      // accumulated text. We start `pending` empty; the next chunk event
      // appends to message.content (which we'll set to assistantText below).
      streamChunkBufRef.current = {
        assistantUiId: state.assistantUiId,
        pending: "",
      };
    }
  }

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
      setPendingApprovals([]);
      setActiveRunId(null);
      setApprovalInFlight({});
      setApprovalError(null);
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
    hydrateLocalFromSnapshot(state);
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
      // Cold-open mid-stream: the panel never persisted the assistant
      // placeholder (it lived only in memory and the window closed
      // inside the 250ms debounce). Synthesize one now so subsequent
      // chunk/verbose flushes — which match by ``assistantUiId`` —
      // have a bubble to mutate. The matching user bubble is owned by
      // the Hermes backplane (api_server persists user messages at
      // request time) and was loaded into ``prev`` by ``loadMessages``.
      const synthesized: UiMessage = {
        uiId: state.assistantUiId!,
        role: "assistant",
        content: "",
        ...merged,
      };
      return [...arr, synthesized];
    });
    applyVerboseToAssistant();
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
      resolvePendingTurn(sessionId);
      return;
    }
    cancelStreamChunkFlush();
    applyVerboseToAssistant();
    cancelVerboseFlush();
    flushStreamChunksToMessages();
    const assistantUiId =
      streamChunkBufRef.current?.assistantUiId ??
      verboseStateRef.current?.assistantUiId ??
      null;
    streamChunkBufRef.current = null;
    verboseStateRef.current = null;
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
    resolvePendingTurn(sessionId);
  }

  function handleStreamAborted(sessionId: string): void {
    if (sessionId !== sessions.activeId) {
      rejectPendingTurn(sessionId, new DOMException("aborted", "AbortError"));
      return;
    }
    cancelStreamChunkFlush();
    applyVerboseToAssistant();
    cancelVerboseFlush();
    flushStreamChunksToMessages();
    const assistantUiId =
      streamChunkBufRef.current?.assistantUiId ??
      verboseStateRef.current?.assistantUiId ??
      null;
    streamChunkBufRef.current = null;
    verboseStateRef.current = null;
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
    rejectPendingTurn(sessionId, new DOMException("aborted", "AbortError"));
  }

  function handleStreamError(
    sessionId: string,
    event: Extract<StreamEvent, { kind: "error" }>,
  ): void {
    if (sessionId !== sessions.activeId) {
      rejectPendingTurn(sessionId, new Error(event.message));
      return;
    }
    cancelStreamChunkFlush();
    cancelVerboseFlush();
    const assistantUiId =
      streamChunkBufRef.current?.assistantUiId ??
      verboseStateRef.current?.assistantUiId ??
      null;
    streamChunkBufRef.current = null;
    verboseStateRef.current = null;
    setPendingQueue((pq) => {
      for (const q of pq) {
        for (const a of q.attachments) void deleteAttachmentFile(a);
      }
      return [];
    });
    // Errors wipe the queue, so the paused flag (if any) is meaningless now.
    setQueuePaused(false);
    setPendingApprovals([]);
    setApprovalInFlight({});
    setApprovalError(null);
    setError({ message: event.message, hint: event.hint });
    if (assistantUiId) {
      sessions.setActiveMessages((prev) =>
        (prev as UiMessage[]).filter((m) => m.uiId !== assistantUiId),
      );
    }
    setBusy(false);
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
        if (!streamChunkBufRef.current) {
          streamChunkBufRef.current = {
            assistantUiId: event.assistantUiId,
            pending: "",
          };
        }
        if (!verboseStateRef.current) {
          verboseStateRef.current = {
            assistantUiId: event.assistantUiId,
            reasoning: "",
            tools: [],
            hermesOrder: [],
            hermesById: new Map(),
            timeline: [],
          };
        }
        break;
      case "chunk": {
        const slot = streamChunkBufRef.current;
        if (slot) slot.pending += event.text;
        appendTextToVerboseTimeline(event.text);
        scheduleStreamChunkFlush();
        scheduleVerboseFlush();
        break;
      }
      case "reasoning": {
        const v = verboseStateRef.current;
        if (v) v.reasoning += event.text;
        scheduleVerboseFlush();
        break;
      }
      case "toolCalls": {
        const v = verboseStateRef.current;
        if (v) v.tools = event.calls.slice();
        scheduleVerboseFlush();
        break;
      }
      case "hermesToolProgress": {
        const v = verboseStateRef.current;
        const inner = event.event;
        if (v) {
          if (!v.hermesById.has(inner.toolCallId)) {
            v.hermesOrder.push(inner.toolCallId);
            appendToolToVerboseTimeline(inner.toolCallId);
          }
          v.hermesById.set(inner.toolCallId, inner);
        }
        scheduleVerboseFlush();
        break;
      }
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
      case "approvalRequest": {
        const req = event.request;
        setPendingApprovals((prev) => {
          const without = prev.filter((a) => a.approvalId !== req.approvalId);
          return [...without, req];
        });
        // Persist a pending record onto the assistant message so the
        // user can still see "I was asked to approve X" long after the
        // banner closes. The `raw.timestamp` field is Python time.time()
        // in seconds (see gateway/platforms/api_server.py:2933) —
        // multiply to ms.
        const tsField = (req.raw as Record<string, unknown> | undefined)
          ?.timestamp;
        const requestedAt =
          typeof tsField === "number"
            ? tsField * 1000
            : Date.now();
        appendApprovalRecord(req, requestedAt);
        // Clear any leftover in-flight marker for a re-emitted request.
        setApprovalInFlight((prev) => {
          if (!(req.approvalId in prev)) return prev;
          const next = { ...prev };
          delete next[req.approvalId];
          return next;
        });
        break;
      }
      case "approvalResolved": {
        const id = event.approvalId;
        setPendingApprovals((prev) =>
          prev.filter((a) => a.approvalId !== id),
        );
        setApprovalInFlight((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        break;
      }
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

  async function refreshLearnStatus() {
    if (!capabilities.learn) return;
    try {
      const r = await capabilities.learn.getStatus();
      setLearnRecording(!!r.active);
      setLearnEventCount(typeof r.eventCount === "number" ? r.eventCount : 0);
    } catch {
      // Engine not ready yet.
    }
  }

  async function startLearnFromPanel() {
    if (!capabilities.learn || !capabilities.pageContext) return;
    try {
      const tab = await capabilities.pageContext.getActiveBrowserTab();
      if (tab?.id === undefined) {
        setPageError(
          "Cannot start recording: no active web tab detected. Open the page you want to demo, then click “Record actions”.",
        );
        return;
      }
      const r = await capabilities.learn.start(tab.id);
      if (!r?.ok) {
        setPageError(r?.error || t("sidepanel.permission.failedRecordStart"));
        return;
      }
      await refreshLearnStatus();
    } catch (e) {
      setPageError(String((e as Error)?.message || e));
    }
  }

  async function stopLearnToComposer() {
    if (!capabilities.learn) return;
    setLearnStopBusy(true);
    let trace: unknown = null;
    try {
      const r = (await withTimeout(
        capabilities.learn.stop(),
        25_000,
        "Stop-recording request timed out (the extension background may be asleep)",
      )) as { ok?: boolean; trace?: unknown; error?: string };
      if (!r?.ok) {
        setPageError(r?.error || t("sidepanel.permission.failedRecordStop"));
        return;
      }
      if (!r.trace) {
        setPageError(
          "No active recording, or the session has expired. Click “Record actions” first, demonstrate, then click “Stop and attach”.",
        );
        await refreshLearnStatus();
        return;
      }
      trace = r.trace;
    } catch (e) {
      setPageError(String((e as Error)?.message || e));
      return;
    } finally {
      // Clear before attachment upload: the put can hang for a long time when
      // the bridge isn't connected, and we don't want the "Stop" button stuck
      // in a perpetual "processing…" state while we wait on it.
      setLearnStopBusy(false);
    }

    await refreshLearnStatus();

    setAttachmentBusy(true);
    setAttachmentError(null);
    const sessionId = sessions.ready
      ? await sessions.ensureActive()
      : "default";
    const name = `learn-trace-${Date.now()}.json`;
    const blob = new Blob([JSON.stringify(trace, null, 2)], {
      type: "application/json",
    });
    const pendingUiId = shortId("att");
    const pending: Attachment = {
      uiId: pendingUiId,
      name,
      mime: "application/json",
      size: blob.size,
      kind: classify(name, "application/json"),
      uploading: true,
    };
    setAttachments((prev) => [...prev, pending]);
    try {
      const read = (await withTimeout(
        readBlobAsAttachment({
          blob,
          name,
          mime: "application/json",
          options: { sessionId, uiId: pendingUiId },
        }),
        130_000,
        "Recorded-trace upload timed out (keep Hermes online; large traces are slower)",
      )) as AttachmentReadResult;
      if (!isAttachmentReadOk(read)) {
        const hint =
          read.error.includes("No Hermes plugin peer") ||
          read.error.includes("role=agent")
            ? "Extension is connected to the bridge, but Hermes hasn't joined as the plugin (agent side missing). Start Hermes and load this browser plugin."
            : "Check that Hermes is running, the bridge is connected, and the gateway is healthy.";
        setAttachmentError(`${read.name}: ${read.error} ${hint}`);
        setAttachments((prev) => prev.filter((a) => a.uiId !== pendingUiId));
        return;
      }
      setAttachments((prev) =>
        prev.map((a) => (a.uiId === pendingUiId ? read.attachment : a)),
      );
      setPageError(null);
    } catch (e) {
      setAttachmentError(String((e as Error)?.message || e));
      setAttachments((prev) => prev.filter((a) => a.uiId !== pendingUiId));
    } finally {
      setAttachmentBusy(false);
    }
    await refreshLearnStatus();
  }

  // Learn status: capability emits state changes when active recording
  // toggles in the engine; we re-fetch on every change.
  useEffect(() => {
    void refreshLearnStatus();
    if (!capabilities.learn) return;
    return capabilities.learn.onStateChange((status) => {
      setLearnRecording(!!status.active);
      setLearnEventCount(typeof status.eventCount === "number" ? status.eventCount : 0);
    });
  }, [capabilities.learn]);

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
  // Workspace binding: per-session. Each chat session can pin its own
  // directory; the chip + drop overlay reflect whichever session is
  // currently active. We re-read on activeId change so switching
  // sessions flips the chip to the new session's binding (or hides it
  // if that session has none). Extension lacks the workspaces sub-API
  // entirely — the chip/drop overlay stays hidden in that case.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const ws = getPlatform().workspaces;
    if (!ws) return;
    const activeId = sessions.activeId;
    if (!activeId) {
      setWorkspacePath(null);
      return;
    }
    let cancelled = false;
    void ws.getCurrent(activeId).then((p) => {
      if (!cancelled) setWorkspacePath(p);
    });
    const unsub = ws.onChange((change) => {
      // Only react to changes for the session this surface is showing —
      // a bind on session B should not move session A's chip.
      if (change.sessionId !== activeId) return;
      if (change.kind === "bound") setWorkspacePath(change.path);
      else if (change.kind === "unbound") setWorkspacePath(null);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [sessions.activeId]);

  /**
   * Resolve a dropped folder's absolute path. Electron 33 removed the
   * legacy `File.path` field; the preload bridge exposes
   * `webUtils.getPathForFile()` under `window.hermes.workspaces.getPathForFile`.
   * Returns null when the bridge isn't present (extension / web).
   */
  function resolveDroppedFolderPath(file: File): string | null {
    const bridge = (window as unknown as { hermes?: { workspaces?: { getPathForFile?: (f: File) => string } } })
      .hermes?.workspaces?.getPathForFile;
    if (!bridge) return null;
    try {
      const p = bridge(file);
      return p && p.length > 0 ? p : null;
    } catch {
      return null;
    }
  }

  /**
   * True iff the active drag carries at least one filesystem directory.
   * Used to gate the folder-drop overlay so file drops on the composer
   * (which the composer's own handler owns) don't accidentally trigger
   * workspace binding.
   */
  function dragHasDirectory(dt: DataTransfer): boolean {
    const items = dt.items;
    if (!items) return false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== "file") continue;
      const entry = (
        it as DataTransferItem & {
          webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
        }
      ).webkitGetAsEntry?.();
      if (entry && entry.isDirectory) return true;
    }
    return false;
  }

  async function handleFolderDrop(files: File[]): Promise<void> {
    const ws = getPlatform().workspaces;
    if (!ws) return;
    // First folder wins. Mixed selections (folder + files) pick the folder
    // and ignore the rest — the file drop happens on the composer, not here.
    let chosen: string | null = null;
    for (const f of files) {
      const p = resolveDroppedFolderPath(f);
      if (p) {
        chosen = p;
        break;
      }
    }
    if (!chosen) {
      setWorkspaceError("Could not resolve the dropped folder's path.");
      return;
    }
    try {
      // Bindings are session-scoped: ensure an active session exists so a
      // drop on a brand-new app launch (no chat yet) still pins to a real
      // session id rather than failing silently.
      const sessionId = sessions.ready
        ? await sessions.ensureActive()
        : null;
      if (!sessionId) {
        setWorkspaceError(
          "Open or start a chat session before binding a workspace.",
        );
        return;
      }
      await ws.bind(sessionId, chosen);
      setWorkspaceError(null);
    } catch (e) {
      setWorkspaceError(String((e as Error)?.message || e));
    }
  }

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
  const lastSeenActiveRef = useRef<string>("");
  useEffect(() => {
    if (sessions.activeId !== lastSeenActiveRef.current) {
      const wasInitialised = lastSeenActiveRef.current !== "";
      lastSeenActiveRef.current = sessions.activeId;
      resetLiveStreamState();
      if (wasInitialised) {
        setPendingQueue((prev) => {
          for (const q of prev) {
            for (const a of q.attachments) void deleteAttachmentFile(a);
          }
          return [];
        });
        // Queue is scoped to a session; switching tabs drops it, so
        // any paused flag for the prior session must drop too.
        setQueuePaused(false);
        // Pending approvals are also session-scoped — clear them on
        // switch; the new session's snapshot will repopulate if it has
        // its own pending approvals.
        setPendingApprovals([]);
        setActiveRunId(null);
        setApprovalInFlight({});
        setApprovalError(null);
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
    cancelStreamChunkFlush();
    cancelVerboseFlush();
    streamChunkBufRef.current = {
      assistantUiId: assistantMsg.uiId,
      pending: "",
    };
    verboseStateRef.current = {
      assistantUiId: assistantMsg.uiId,
      reasoning: "",
      tools: [],
      hermesOrder: [],
      hermesById: new Map(),
      timeline: [],
    };

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
      // If the user hit Stop, the queue was deliberately frozen — don't
      // re-fire it until they explicitly resume. Otherwise drain the head.
      if (!queuePausedRef.current) {
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

  async function send() {
    const text = input.trim();
    // Allow send when the user has uploaded attachments but hasn't typed
    // anything (e.g. "here's a screenshot — what's wrong with it?"). We
    // still gate on having SOMETHING to send so an empty composer with
    // no attachments stays a no-op.
    if (!text && attachments.every((a) => !a.path || a.uploading)) return;
    if (attachmentUploading) return;
    if (!sessions.ready) return;

    // Edit-then-Send: clicking Send while editing a queued item means
    // "save my changes and fire this one now" — equivalent to the per-row
    // send-now button on the same item.
    if (editingQueueId != null) {
      sendQueueItemNow(editingQueueId);
      return;
    }

    const attachmentsForSend = attachments.filter((a) => a.path && !a.uploading);

    // Capture the user's current tab BEFORE the queue/send branches. Snapshot
    // belongs to the moment the user pressed send — by the time a queued
    // turn fires, the user has very possibly switched tabs. ``undefined`` on
    // desktop or when the capability declines (restricted URL etc.).
    let turnMetadataForSend: TurnMetadata | undefined;
    try {
      const snap = await capabilities.pageContext?.captureBrowserTabSnapshot();
      if (snap) turnMetadataForSend = { browser_tab_snapshot: snap };
    } catch {
      // Snapshot failures should never block the user's send.
    }

    if (busy) {
      setPendingQueue((prev) => [
        ...prev,
        {
          queueId: shortId("q"),
          text,
          attachments: attachmentsForSend.map((a) => ({ ...a })),
          navigateOpenPolicySnapshot: navigateOpenPolicy,
          turnMetadataSnapshot: turnMetadataForSend,
        },
      ]);
      setInput("");
      setAttachments([]);
      // Page attachments are one-shot — clear so they don't double-attach
      // to a follow-up turn the user types while this one is still in flight.
      setAttachmentError(null);
      // Sending a new message implicitly un-pauses: the user is clearly
      // ready for the queue to move again. The current stream will finish
      // and the finally-drain will kick in normally.
      if (queuePausedRef.current) setQueuePaused(false);
      return;
    }

    setInput("");
    setAttachments([]);
    setAttachmentError(null);
    // The "from <App>" chip belongs to a single hand-off turn — clear
    // it on send so it doesn't trail the user into their next prompt.
    setPendingSourceApp(null);

    // Not busy. If the queue was paused (i.e., user hit Stop and left items
    // queued), unpause first so the runChatTurn's finally-drain fires the
    // remaining items after this fresh turn completes.
    if (queuePausedRef.current) setQueuePaused(false);

    await runChatTurn({
      text,
      attachments: attachmentsForSend,
      navigateOpenPolicyForTurn: navigateOpenPolicy,
      turnMetadataForTurn: turnMetadataForSend,
    });
  }

  // Keep the ref pointed at the latest `send` closure so the
  // pending-autosend effect can fire it without putting a fresh function
  // identity into its deps array on every render.
  sendRef.current = send;

  function stop() {
    // Preserve the pending queue. Hitting Stop while items are queued is
    // a "halt and let me think" gesture — wiping the queue forces the user
    // to retype everything they had lined up. We freeze auto-drain with
    // `queuePaused` so the next finished stream doesn't immediately fire
    // the next queued item behind the user's back.
    setQueuePaused(true);
    const sid = sessions.activeId;
    if (sid) {
      try {
        client.abort(sid);
      } catch (e) {
        console.warn("[sidepanel] abort failed:", e);
      }
    }
  }

  function removePendingQueueItem(queueId: string) {
    setPendingQueue((prev) => {
      const hit = prev.find((q) => q.queueId === queueId);
      if (hit) {
        for (const a of hit.attachments) void deleteAttachmentFile(a);
      }
      return prev.filter((q) => q.queueId !== queueId);
    });
    // If we just deleted the row that was being edited, drop edit mode so
    // the composer doesn't keep a ghost reference to a vanished item.
    if (editingQueueId === queueId) {
      setEditingQueueId(null);
      setInput("");
      for (const a of attachments) void deleteAttachmentFile(a);
      setAttachments([]);
    }
  }

  /**
   * Enter edit mode for a queued item. The item STAYS in the queue (the
   * user explicitly asked for this — clicking edit shouldn't lose the slot
   * in the queue). The composer mirrors its content for editing, the queue
   * is paused so nothing fires past it, and the editing row gets a visual
   * marker. If the composer already had a draft, that draft is appended
   * to the queue end so nothing is lost.
   */
  function editPendingQueueItem(queueId: string) {
    const item = pendingQueue.find((q) => q.queueId === queueId);
    if (!item) return;
    const draftText = input;
    const draftAttachments = attachments.filter((a) => a.path && !a.uploading);
    const draftPolicy = navigateOpenPolicy;
    const hasDraft =
      draftText.trim().length > 0 || draftAttachments.length > 0;

    setPendingQueue((prev) => {
      if (!hasDraft) return prev;
      return [
        ...prev,
        {
          queueId: shortId("q"),
          text: draftText,
          attachments: draftAttachments.map((a) => ({ ...a })),
          navigateOpenPolicySnapshot: draftPolicy,
          // No fresh snapshot here — this branch only fires when the
          // composer already had a draft AND the user clicked "edit
          // another queued item". The draft was typed earlier without a
          // snapshot pipeline, so we let the queued item ride without
          // one rather than re-snapshot at edit time (which would point
          // at whatever tab the user is on right now, not the draft's
          // original context).
        },
      ];
    });
    setEditingQueueId(queueId);
    setInput(item.text);
    setAttachments(item.attachments.map((a) => ({ ...a })));
    setNavigateOpenPolicy(item.navigateOpenPolicySnapshot);
    setQueuePaused(true);
  }

  /** Exit edit mode without saving the composer content back to the queue. */
  function cancelQueueEdit() {
    if (editingQueueId == null) return;
    setEditingQueueId(null);
    setInput("");
    for (const a of attachments) void deleteAttachmentFile(a);
    setAttachments([]);
  }

  /**
   * Kick the head of the queue back into runChatTurn. Used by send-now and
   * by `send()` when the user dispatches a new message while the queue is
   * paused.
   */
  function drainPendingQueueHead() {
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

  /**
   * "Send now": move this item to the front of the queue, unpause, and
   * (when not already streaming) fire it immediately. While busy, the
   * reorder is enough — the runChatTurn finally-drain picks up the new
   * head when the current stream ends. If the user was editing this exact
   * item, commit the composer content into the item first so the fired
   * version includes their edits.
   */
  function sendQueueItemNow(queueId: string) {
    const editingThisOne = editingQueueId === queueId;
    if (editingThisOne) {
      // Build the updated payload from current composer state — this is the
      // committed-edit version that fires.
      const previous = pendingQueue.find((q) => q.queueId === queueId);
      const updated: PendingChatTurn = {
        queueId,
        text: input,
        attachments: attachments
          .filter((a) => a.path && !a.uploading)
          .map((a) => ({ ...a })),
        navigateOpenPolicySnapshot: navigateOpenPolicy,
        // Keep the original snapshot from queue time — re-capturing here
        // would point at "wherever the user is right now while editing",
        // which is rarely the page they wanted to reference.
        turnMetadataSnapshot: previous?.turnMetadataSnapshot,
      };
      setPendingQueue((prev) => {
        const without = prev.filter((q) => q.queueId !== queueId);
        return [updated, ...without];
      });
      setEditingQueueId(null);
      setInput("");
      setAttachments([]);
    } else {
      setPendingQueue((prev) => {
        const item = prev.find((q) => q.queueId === queueId);
        if (!item) return prev;
        const without = prev.filter((q) => q.queueId !== queueId);
        return [item, ...without];
      });
    }
    setQueuePaused(false);
    if (busy) {
      // Interrupt the in-flight stream so the promoted item fires
      // immediately. The cascade is:
      //   1. POST `abort` to the SW engine → ctrl.abort() → SSE fetch
      //      throws AbortError → engine catch → emit "aborted"
      //   2. Panel `handleStreamAborted` → rejects pendingTurnRef →
      //      runChatTurn's await rethrows → catch (logs) → finally
      //   3. finally sees `queuePaused === false` (we just cleared it
      //      above) → drains queue head (= this just-promoted item) →
      //      fires it via a fresh runChatTurn
      // The current stream's partial response is marked [stopped] —
      // that's the explicit cost the user is paying for "send now".
      const sid = sessions.activeId;
      if (sid) {
        try {
          client.abort(sid);
        } catch (e) {
          console.warn("[sidepanel] abort-for-send-now failed:", e);
        }
      }
    } else {
      queueMicrotask(() => drainPendingQueueHead());
    }
  }

  /**
   * Append (or refresh) the persistent approval record on whichever
   * assistant message is currently streaming. Idempotent: re-emits of
   * the same approval (e.g. gateway retry, panel reopen during a still-
   * pending approval) overwrite the existing record rather than
   * stacking duplicates. Skipped silently when there's no active
   * assistant message — the gateway shouldn't fire an approval outside
   * a turn, but we don't want to crash if it does.
   */
  function appendApprovalRecord(
    req: HermesApprovalRequest,
    requestedAt: number,
  ): void {
    const uiId =
      verboseStateRef.current?.assistantUiId ??
      streamChunkBufRef.current?.assistantUiId;
    if (!uiId) return;
    const record: ApprovalRecord = {
      approvalId: req.approvalId,
      command: req.command,
      tool: req.tool,
      description: req.description,
      reason: req.reason,
      requestedAt,
    };
    // Drop a timeline marker too so the approval chip renders inline
    // (between whatever text/tool items preceded it). Idempotent —
    // re-firing the same approval doesn't double up.
    appendApprovalToVerboseTimeline(req.approvalId);
    scheduleVerboseFlush();
    sessions.setActiveMessages((prev) =>
      (prev as UiMessage[]).map((m) => {
        if (m.uiId !== uiId) return m;
        const existing = m.hermesApprovalRecords ?? [];
        const without = existing.filter(
          (r) => r.approvalId !== req.approvalId,
        );
        return {
          ...m,
          hermesApprovalRecords: [...without, record],
        };
      }),
    );
  }

  /**
   * Stamp the final outcome on a persisted record. Searches every
   * message in the active session — the approval may have been
   * recorded against a message that's no longer the head, especially
   * when expired approvals are settled long after the turn moved on.
   * No-op when the record is already settled (don't trample a real
   * outcome with a follow-up `expired`/`failed`).
   */
  function markApprovalOutcome(
    approvalId: string,
    outcome: ApprovalOutcome,
    decidedAt: number,
  ): void {
    if (!approvalId) return;
    sessions.setActiveMessages((prev) =>
      (prev as UiMessage[]).map((m) => {
        const records = m.hermesApprovalRecords;
        if (!records || records.length === 0) return m;
        const i = records.findIndex((r) => r.approvalId === approvalId);
        if (i < 0) return m;
        if (records[i].outcome) return m;
        const next = records.slice();
        next[i] = { ...next[i], outcome, decidedAt };
        return { ...m, hermesApprovalRecords: next };
      }),
    );
  }

  /**
   * POST a user decision for one pending approval and clear the local card
   * optimistically. The SW chat engine also drops the approval from its
   * runtime state via the `clearApproval` port message so any other panel
   * subscribed to the same session loses the card too (matches the
   * "multi-panel see same stream" guarantee from the engine refactor).
   */
  async function respondToApproval(
    request: HermesApprovalRequest,
    decision: HermesApprovalDecision,
  ): Promise<void> {
    setApprovalError(null);
    const runId = request.runId || activeRunId || "";
    if (!runId) {
      setApprovalError(
        "Missing run id for this approval. The gateway didn't return X-Hermes-Run-Id and the event payload didn't include one.",
      );
      return;
    }
    setApprovalInFlight((prev) => ({
      ...prev,
      [request.approvalId]: decision,
    }));
    const res = await postHermesApprovalDecision({
      runId,
      approvalId: request.approvalId,
      decision,
    });
    if (!res.ok) {
      // 409 `approval_not_active` means the gateway has already timed out
      // and cleaned up this approval session (default
      // approvals.gateway_timeout = 300s). The agent has been unblocked
      // with a BLOCKED response, the run has typically finished, and
      // there's nothing left to approve. Treat it as "card is stale" —
      // drop it locally + show a friendly notice instead of leaving the
      // user clicking a button that will never succeed.
      const errStr = res.error || "";
      const isStale =
        res.status === 409 ||
        errStr.includes("approval_not_active") ||
        errStr.includes("no active approval session") ||
        errStr.includes("no pending approval");
      if (isStale) {
        setPendingApprovals((prev) =>
          prev.filter((a) => a.approvalId !== request.approvalId),
        );
        setApprovalInFlight((prev) => {
          const next = { ...prev };
          delete next[request.approvalId];
          return next;
        });
        // Sync the engine so its runtime state also drops the stale pending,
        // matching the optimistic-clear behaviour on a successful POST.
        const sid = sessions.activeId;
        if (sid) {
          try {
            client.clearApproval(sid, request.approvalId);
          } catch {
            // Best-effort.
          }
        }
        // Stamp the persisted record so the history chip flips to
        // "Expired" instead of staying in a perpetual pending state.
        markApprovalOutcome(request.approvalId, "expired", Date.now());
        setApprovalError(
          "Approval timed out (default 5 minutes); the command was auto-denied. To extend the window, add `gateway_timeout: 600` under the `approvals` section of ~/.hermes/config.yaml.",
        );
        return;
      }
      // POST failed for a non-stale reason (network down, gateway error,
      // bad auth). Mark the record as `failed` so it doesn't stay
      // "Waiting…" forever in the history view.
      markApprovalOutcome(request.approvalId, "failed", Date.now());
      setApprovalError(
        `Approval failed: ${res.error || "unknown"} (HTTP ${res.status ?? "?"})`,
      );
      setApprovalInFlight((prev) => {
        const next = { ...prev };
        delete next[request.approvalId];
        return next;
      });
      return;
    }
    // Optimistic clear: drop the card locally and tell the SW to do the
    // same in its runtime state. The gateway's eventual `approval.responded`
    // SSE event becomes a no-op (already cleared).
    setPendingApprovals((prev) =>
      prev.filter((a) => a.approvalId !== request.approvalId),
    );
    setApprovalInFlight((prev) => {
      const next = { ...prev };
      delete next[request.approvalId];
      return next;
    });
    markApprovalOutcome(request.approvalId, decision, Date.now());
    const sid = sessions.activeId;
    if (sid) {
      try {
        client.clearApproval(sid, request.approvalId);
      } catch (e) {
        console.warn("[sidepanel] clearApproval failed:", e);
      }
    }
  }

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
    setPendingQueue((prev) => {
      for (const q of prev) {
        for (const a of q.attachments) void deleteAttachmentFile(a);
      }
      return [];
    });
    setQueuePaused(false);
    setPendingApprovals([]);
    setActiveRunId(null);
    setApprovalInFlight({});
    setApprovalError(null);
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
  // across SidePanelView, HomeView, and the Quick-Ask popup; touching
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
      busyQueueable
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
        onDragOver={(e) => {
          // Workspace binding is a desktop-only capability — bail early on
          // the extension surface so the composer's file-drop handler keeps
          // owning the chat-area drop without competition.
          if (!getPlatform().workspaces) return;
          const dt = e.dataTransfer;
          if (!dt) return;
          if (!Array.from(dt.types || []).includes("Files")) return;
          if (!dragHasDirectory(dt)) return;
          e.preventDefault();
          if (!folderDragOver) setFolderDragOver(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setFolderDragOver(false);
        }}
        onDrop={(e) => {
          if (!getPlatform().workspaces) return;
          const dt = e.dataTransfer;
          if (!dt || !dragHasDirectory(dt)) return;
          e.preventDefault();
          setFolderDragOver(false);
          const files = Array.from(dt.files || []);
          if (files.length > 0) void handleFolderDrop(files);
        }}
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
                  onClick={() => {
                    const ws = getPlatform().workspaces;
                    if (!ws) return;
                    const sid = sessions.activeId;
                    if (!sid) return;
                    void ws.unbind(sid).catch((e) => {
                      setWorkspaceError(String((e as Error)?.message || e));
                    });
                  }}
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
          {pendingQueue.length > 0 && (
            <div
              className={cn(
                "relative z-[1] overflow-hidden rounded-t-lg border border-input border-b-0 bg-muted/50 shadow-[0_-2px_10px_-2px_rgba(0,0,0,0.12)] dark:bg-muted/35 dark:shadow-[0_-2px_14px_-2px_rgba(0,0,0,0.45)]",
                att.dragOver && "border-primary/50",
              )}
            >
              <ul className="max-h-[7rem] divide-y divide-border/60 overflow-y-auto">
                {pendingQueue.map((item) => {
                  const isEditing = item.queueId === editingQueueId;
                  return (
                    <li
                      key={item.queueId}
                      className="group flex items-center gap-1.5 py-1.5 pl-2.5 pr-1 transition-colors hover:bg-muted/70"
                    >
                      <p
                        className={cn(
                          "min-w-0 flex-1 truncate text-[12px] leading-snug",
                          isEditing
                            ? "text-muted-foreground"
                            : "text-foreground/90",
                        )}
                        title={
                          isEditing
                            ? t("sidepanel.queue.editing")
                            : previewPendingTurn(item)
                        }
                      >
                        {previewPendingTurn(item)}
                      </p>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => sendQueueItemNow(item.queueId)}
                          title={t("sidepanel.queue.sendNow")}
                          aria-label={t("sidepanel.queue.sendNow.aria")}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => editPendingQueueItem(item.queueId)}
                          title={t("sidepanel.queue.edit")}
                          aria-label={t("sidepanel.queue.edit.aria")}
                          disabled={isEditing}
                          className={cn(
                            "rounded p-1 transition-colors",
                            isEditing
                              ? "cursor-default text-foreground/40"
                              : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removePendingQueueItem(item.queueId)}
                          title={t("sidepanel.queue.delete")}
                          aria-label={t("sidepanel.queue.delete")}
                          className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
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
        onDelete={(id) => void sessions.remove(id)}
        onOpenCronSession={onOpenCronSession}
        onRefresh={() => void sessions.refresh()}
      />
    </div>
  );
}
