import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  ChevronUp,
  Disc,
  Folder,
  FolderOpen,
  Globe,
  History,
  Loader2,
  MousePointerClick,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useT, type TranslateFn } from "@hermes-x/i18n";
import { getPlatform, type StorageChangeMap } from "@hermes-x/platform";
import { useResolvedTheme } from "@hermes-x/theme";
import { Button, HermesLogo, ScrollArea, Textarea } from "@hermes-x/ui";
import { cn, shortId } from "@hermes-x/utils";

// Wire-protocol types + engine + helpers — everything that was previously
// imported from extension-local paths now lives in @hermes-x/core.
import {
  ATTACHMENT_INPUT_ACCEPT,
  attachmentToBadge,
  classify,
  deleteAttachmentFile,
  formatBytesShort,
  formatFileAttachmentsForPrompt,
  isAttachmentReadOk,
  postHermesApprovalDecision,
  readBlobAsAttachment,
  readFileAsAttachment,
  useSessions,
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
} from "@hermes-x/core";

// Sub-components + helpers + UI types live next to this file in chat-ui.
import { ApprovalBanner } from "./bubble/approval";
import { AttachmentChip, EmptyState, ErrorBlock, PageChip } from "./bubble/chips";
import { MessageTurns } from "./bubble/Bubble";
import { SessionDrawer } from "./SessionDrawer";
import { TabBar } from "./TabBar";
import {
  bubbleTextContent,
  formatToolDuration,
  hostnameOf,
  splitThinkingFromBody,
} from "./internal/helpers";
import {
  COMPOSER_TEXTAREA_MAX_PX,
  type AssistantTimelineItem,
  type ChatError,
  type MessagesMaxWidth,
  type UiMessage,
} from "./internal/types";

// Capability interfaces let extension-only features (page-context, learn,
// navigateOpenPolicy) plug in without polluting this file with chrome.* APIs.
import type {
  ActiveTabInfo,
  NavigateOpenPolicy,
  PageContextCapability,
  PageContextSnapshot,
  SidePanelCapabilities,
} from "./internal/capabilities";

// PageContext is the snapshot shape used by pinned-page state. Aliased so
// the existing variable names inside SidePanel keep working untouched.
type PageContext = PageContextSnapshot;

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
// Imported below in the consolidated import block. Extension-only types
// (PinnedPage, PendingChatTurn) stay here because they reference
// extension-only domain (PageContext, NavigateOpenPolicy).

/**
 * In-memory record of a page the user has explicitly pinned to the next
 * message. We snapshot the page content at pin time so the attachment
 * survives the user navigating away or closing the source tab. Pinned
 * state is intentionally NOT persisted across panel reloads — the content
 * payloads can be large (~16KB each) and pinning is conceptually a
 * "compose-time" concern, not a session-level one.
 */
interface PinnedPage extends PageContext {
  uiId: string;
}

/** One user turn waiting while the model is still streaming the previous reply. */
interface PendingChatTurn {
  queueId: string;
  text: string;
  attachments: Attachment[];
  attachedPagesSnapshot: PinnedPage[];
  navigateOpenPolicySnapshot: NavigateOpenPolicy;
}

// openAgentDestinationInUserWindow lives in the extension wrapper as a
// concrete chrome.windows + chrome.tabs implementation; SidePanelView
// receives it as the `openAgentDestination` prop.

/**
 * Stable no-op stand-in for capabilities.pageContext.useActiveTab when the
 * capability is absent. Always returns the same identity so React sees a
 * consistent hook on every render.
 */
function noActiveTabHook(): { tab: ActiveTabInfo | null; refresh: () => void } {
  return { tab: null, refresh: NOOP };
}
const NOOP = () => {};

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
  // Set when the new-tab Home launcher hands off a prompt via
  // `chrome.storage.local.home.pendingPrompt`. We populate the composer
  // with the text and then auto-fire `send()` once the panel is ready —
  // the user already pressed Enter on Home, so an extra Send click here
  // would be friction.
  const [pendingAutosend, setPendingAutosend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  // Pinned pages live alongside the live current-tab attachment. Each is
  // a frozen snapshot taken at pin time so the user can keep referencing
  // a page even after they navigate away or close its tab. Reset on
  // conversation switch (see the activeId effect below).
  const [pinnedPages, setPinnedPages] = useState<PinnedPage[]>([]);
  const [pinning, setPinning] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  // Composer-time uploads — files the user dropped, pasted or picked
  // before sending the next turn. Like `pinnedPages`, these are
  // intentionally NOT persisted across panel reloads: the data URLs can
  // be sizeable and "what's in my composer" is a session-volatile
  // concept. After send we lift only a lightweight `AttachmentBadge`
  // onto the user message so the chip survives reloads.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentUploading = attachments.some((a) => !!a.uploading);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [learnRecording, setLearnRecording] = useState(false);
  const [learnEventCount, setLearnEventCount] = useState(0);
  const [learnStopBusy, setLearnStopBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /**
   * Workspace binding for this surface. `null` when no directory is bound
   * or the platform doesn't expose a WorkspaceAdapter (extension). The chat
   * area renders a folder-drop overlay when `folderDragOver` is true; the
   * composer toolbar shows a path chip when `workspacePath` is non-null.
   */
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [folderDragOver, setFolderDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Composer textarea: grows with content up to max, then scrolls inside. */
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Active tab tracking — only meaningful in extension. Capability must
  // provide a stable hook reference; desktop falls back to a no-op default
  // so rules-of-hooks ordering stays consistent across renders.
  const useActiveTabHook = capabilities.pageContext?.useActiveTab ?? noActiveTabHook;
  const { tab: activeTab, refresh: refreshActiveTab } = useActiveTabHook();
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

  // Pick up a prompt handed off from the new-tab Home launcher. The Home
  // page stores `{ text }` under `home.pendingPrompt` and opens the side
  // panel; we drain that key here, prefill the composer, and flag the
  // turn for auto-send once `sessions.ready` resolves. We clear the
  // storage key immediately so re-mounts (SW restart, panel reopen) don't
  // resubmit the same prompt.
  useEffect(() => {
    let cancelled = false;
    const drain = capabilities.pendingPrompt?.drain;
    if (!drain) return;
    void drain().then((text) => {
      if (cancelled || !text || !text.trim()) return;
      setInput(text);
      setPendingAutosend(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

    // Live / interrupted / completed — SW state is authoritative.
    // Rebuild local accumulators from the snapshot, then overlay
    // accumulated content onto the matching assistant bubble.
    const { state } = frame;
    hydrateLocalFromSnapshot(state);
    setBusy(state.streaming);
    setPendingApprovals(state.pendingApprovals ?? []);
    setActiveRunId(state.runId ?? null);
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

  useLayoutEffect(() => {
    const el = composerTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const sh = el.scrollHeight;
    const next = Math.min(sh, COMPOSER_TEXTAREA_MAX_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = sh > COMPOSER_TEXTAREA_MAX_PX ? "auto" : "hidden";
  }, [input, pendingQueue.length]);

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
  // Workspace binding: load the current bound path from the platform adapter
  // and stay in sync with bind/unbind events. Extension lacks the workspaces
  // sub-API entirely — the chip/drop overlay stays hidden in that case.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const ws = getPlatform().workspaces;
    if (!ws) return;
    let cancelled = false;
    void ws.getCurrent().then((p) => {
      if (!cancelled) setWorkspacePath(p);
    });
    const unsub = ws.onChange((change) => {
      if (change.kind === "bound") setWorkspacePath(change.path);
      else if (change.kind === "unbound") setWorkspacePath(null);
      // `file` events don't change the binding itself, so the chip text
      // stays put. We deliberately don't re-render on every file event —
      // it would be a busy no-op for this surface.
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

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
      await ws.bind(chosen);
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
        setPinnedPages([]);
        setPageError(null);
        // Same fire-and-forget GC as `newChat` — the composer-time
        // attachments belonged to the session we're leaving.
        for (const a of attachments) void deleteAttachmentFile(a);
        setAttachments([]);
        setAttachmentError(null);
      }
    }
  }, [sessions.activeId]);

  const composerHasSendablePayload =
    !!input.trim() ||
    attachments.some((a) => a.path && !a.uploading);

  async function runChatTurn(args: {
    text: string;
    attachments: Attachment[];
    attachedPagesForTurn: PinnedPage[];
    navigateOpenPolicyForTurn: NavigateOpenPolicy;
  }): Promise<void> {
    const {
      text,
      attachments: attachmentsForTurn,
      attachedPagesForTurn,
      navigateOpenPolicyForTurn,
    } = args;

    setError(null);
    setPageError(null);

    const sessionId = await sessions.ensureActive();

    // One-shot page attachments for THIS turn only. Each was captured at
    // pin time (eager snapshot) — `attachedPages` is cleared after send so
    // they never persist into follow-up turns. Inspecting the user's tab
    // live happens via the agent's `my_browser_active_tab` tool.
    const pages: PageContext[] = [...attachedPagesForTurn];

    const pageContextBlock =
      pages.length > 0 && capabilities.pageContext
        ? capabilities.pageContext.formatPageContextsForPrompt(pages)
        : "";
    const pageBadges =
      pages.length > 0
        ? pages.map((p) => ({ title: p.title ?? "", url: p.url ?? "" }))
        : undefined;

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
      // Annotate the user bubble with the pages we attached so the user
      // can see what context the model was given for this turn.
      pageBadges,
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
    const wireUserContent = [pageContextBlock, fileAttachmentBlock, userMsg.content]
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
              attachedPagesForTurn: head.attachedPagesSnapshot,
              navigateOpenPolicyForTurn: head.navigateOpenPolicySnapshot,
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

    if (busy) {
      setPendingQueue((prev) => [
        ...prev,
        {
          queueId: shortId("q"),
          text,
          attachments: attachmentsForSend.map((a) => ({ ...a })),
          attachedPagesSnapshot: pinnedPages.map((p) => ({ ...p })),
          navigateOpenPolicySnapshot: navigateOpenPolicy,
        },
      ]);
      setInput("");
      setAttachments([]);
      // Page attachments are one-shot — clear so they don't double-attach
      // to a follow-up turn the user types while this one is still in flight.
      setPinnedPages([]);
      setAttachmentError(null);
      // Sending a new message implicitly un-pauses: the user is clearly
      // ready for the queue to move again. The current stream will finish
      // and the finally-drain will kick in normally.
      if (queuePausedRef.current) setQueuePaused(false);
      return;
    }

    setInput("");
    setAttachments([]);
    const attachedPagesForSend = pinnedPages.map((p) => ({ ...p }));
    setPinnedPages([]);
    setAttachmentError(null);

    // Not busy. If the queue was paused (i.e., user hit Stop and left items
    // queued), unpause first so the runChatTurn's finally-drain fires the
    // remaining items after this fresh turn completes.
    if (queuePausedRef.current) setQueuePaused(false);

    await runChatTurn({
      text,
      attachments: attachmentsForSend,
      attachedPagesForTurn: attachedPagesForSend,
      navigateOpenPolicyForTurn: navigateOpenPolicy,
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
      setPinnedPages([]);
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
    const draftPinnedPages = pinnedPages;
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
          attachedPagesSnapshot: draftPinnedPages.map((p) => ({ ...p })),
          navigateOpenPolicySnapshot: draftPolicy,
        },
      ];
    });
    setEditingQueueId(queueId);
    setInput(item.text);
    setAttachments(item.attachments.map((a) => ({ ...a })));
    setPinnedPages(item.attachedPagesSnapshot.map((p) => ({ ...p })));
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
    setPinnedPages([]);
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
          attachedPagesForTurn: head.attachedPagesSnapshot,
          navigateOpenPolicyForTurn: head.navigateOpenPolicySnapshot,
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
      const updated: PendingChatTurn = {
        queueId,
        text: input,
        attachments: attachments
          .filter((a) => a.path && !a.uploading)
          .map((a) => ({ ...a })),
        attachedPagesSnapshot: pinnedPages.map((p) => ({ ...p })),
        navigateOpenPolicySnapshot: navigateOpenPolicy,
      };
      setPendingQueue((prev) => {
        const without = prev.filter((q) => q.queueId !== queueId);
        return [updated, ...without];
      });
      setEditingQueueId(null);
      setInput("");
      setAttachments([]);
      setPinnedPages([]);
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
    setPinnedPages([]);
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

  // Whether the *currently active* tab's URL is already pinned. Drives
  // the visual state of the Pin segment in the composer pill so the user
  // can tell at a glance whether clicking it will pin or unpin.
  const isCurrentPagePinned =
    !!activeTab?.url && pinnedPages.some((p) => p.url === activeTab.url);
  // If the current tab can't be scripted (chrome://, Web Store, etc.) we
  // can detect that synchronously from the URL alone — there's no point
  // letting the user click Pin only to surface the error after a
  // round-trip through `chrome.scripting.executeScript`. Stays `null` for
  // pages we should attempt; otherwise carries the reason we'll show as a
  // tooltip on the disabled Pin button.
  const pageRestrictedReason =
    capabilities.pageContext?.getPageRestrictedReason(activeTab?.url) ?? null;
  // Allow unpinning even on a restricted current page: that operation
  // doesn't touch the page, it just removes a previously-captured
  // snapshot from the in-memory list.
  const pinDisabled =
    pinning || (!!pageRestrictedReason && !isCurrentPagePinned);

  // One handler for both directions:
  //   - If the current tab's URL is already in the pinned list → unpin it.
  //   - Otherwise → snapshot the page (eager capture so the pin survives
  //     navigation / tab close) and append.
  // We capture eagerly rather than just remembering a tab id because the
  // whole point of pinning vs. the live "Page" toggle is to outlive the
  // tab's current state.
  async function toggleCurrentPagePin() {
    if (pinning) return;
    setPageError(null);

    const url = activeTab?.url;
    if (url) {
      const existing = pinnedPages.find((p) => p.url === url);
      if (existing) {
        unpinPage(existing.uiId);
        return;
      }
    }

    setPinning(true);
    try {
      const captured = await capabilities.pageContext?.capturePage();
      if (!captured) {
        setPageError("Page capture is not available in this surface.");
        return;
      }
      const ctx = captured;
      setPinnedPages((prev) => {
        if (prev.some((p) => p.url === ctx.url)) return prev;
        return [...prev, { uiId: shortId("pin"), ...ctx }];
      });
    } finally {
      setPinning(false);
    }
  }

  function unpinPage(uiId: string) {
    setPinnedPages((prev) => prev.filter((p) => p.uiId !== uiId));
  }

  /** × handler on a pending-page chip — just drop the snapshot. */
  function dismissPageChip(opts: { uiId?: string }) {
    if (opts.uiId) {
      setPinnedPages((prev) => prev.filter((p) => p.uiId !== opts.uiId));
    }
  }

  /**
   * Read a batch of files into composer-time `Attachment`s. Used by the
   * file picker, drag-and-drop, and clipboard-paste paths so they share
   * one error-handling pipeline. Errors are concatenated into a single
   * banner string so the user sees one chip-row of bad files instead of
   * a stack of disposable toasts.
   *
   * We materialise the active session id up-front (so Python can group
   * uploads under that id) — adding files implicitly creates a session
   * the same way clicking Send does. Anything unsupported on the agent
   * side is still accepted: identifying / parsing the file is the
   * agent's job, not the picker's.
   */
  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setAttachmentBusy(true);
    setAttachmentError(null);
    const pendingUiIds: string[] = [];
    try {
      const sessionId = sessions.ready
        ? await sessions.ensureActive()
        : "default";
      const errors: string[] = [];
      const pending: Attachment[] = files.map((f) => ({
        uiId: shortId("att"),
        name: f.name || "file",
        mime: f.type || "",
        size: f.size,
        kind: classify(f.name || "file", (f.type || "").toLowerCase()),
        uploading: true,
      }));
      pendingUiIds.push(...pending.map((p) => p.uiId));
      setAttachments((prev) => [...prev, ...pending]);
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        const uiId = pending[i].uiId;
        const r = await readFileAsAttachment(f, { sessionId, uiId });
        if (isAttachmentReadOk(r)) {
          setAttachments((prev) => {
            if (!prev.some((a) => a.uiId === uiId)) {
              if (r.attachment.path) void deleteAttachmentFile(r.attachment.path);
              return prev;
            }
            return prev.map((a) => (a.uiId === uiId ? r.attachment : a));
          });
        } else {
          errors.push(`${r.name}: ${r.error}`);
          setAttachments((prev) => prev.filter((a) => a.uiId !== uiId));
        }
      }
      if (errors.length > 0) {
        setAttachmentError(errors.join("\n"));
      }
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      setAttachmentError(`Attachment processing error: ${msg}`);
      setAttachments((prev) => prev.filter((a) => !pendingUiIds.includes(a.uiId)));
    } finally {
      setAttachmentBusy(false);
    }
  }

  function removeAttachment(uiId: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.uiId === uiId);
      if (target?.path) {
        // Best-effort delete of the on-disk file — fire-and-forget so
        // the chip drops instantly without waiting on the bridge.
        void deleteAttachmentFile(target);
      }
      return prev.filter((a) => a.uiId !== uiId);
    });
  }

  /**
   * Open a multi-select file picker. Prefer `showOpenFilePicker({ multiple })`
   * so Chromium shows a native multi-file dialog; fall back to a hidden
   * `<input type="file" multiple>` when the API is missing or errors
   * (e.g. some extension contexts). Re-set `value=""` on the fallback
   * input so picking the same file twice still fires `onChange`.
   */
  async function openFilePicker() {
    const w = window as Window & {
      showOpenFilePicker?: (opts?: {
        multiple?: boolean;
      }) => Promise<FileSystemFileHandle[]>;
    };
    if (typeof w.showOpenFilePicker === "function") {
      try {
        const handles = await w.showOpenFilePicker({ multiple: true });
        if (handles.length === 0) return;
        const files = await Promise.all(handles.map((h) => h.getFile()));
        if (files.length > 0) void addFiles(files);
        return;
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return;
        console.warn("[sidepanel] showOpenFilePicker failed, using fallback:", e);
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  /**
   * Capture pasted images from the clipboard so users can Cmd+V a
   * screenshot straight into the composer. We deliberately don't
   * preventDefault on paste events that contain only text — that would
   * break the normal text-paste behaviour of the textarea.
   */
  async function handleComposerPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    await addFiles(files);
  }

  const messages = sessions.activeMessages as UiMessage[];
  const hasActive = !!sessions.activeId;

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
        variant === "fullscreen" ? "min-h-0 flex-1" : "h-screen",
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
          "relative min-w-0 flex-1 overflow-hidden pt-2",
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
        {hasActive && messages.length === 0 ? (
          // Borderless empty-conversation hint, anchored to a stable
          // viewport-relative offset rather than `justify-center`. The
          // chat area is `flex-1`, so centring against it would cause
          // the content to creep upward whenever the composer grew
          // (chip row, error banners, …) — the chat area shrinks to
          // compensate, and `justify-center` follows the new midpoint.
          // The chat area's TOP edge is stable (it sits right under the
          // TabBar), so `absolute top-[40vh] -translate-y-1/2` pins the
          // hint at a fixed point regardless of footer height. We skip
          // the ScrollArea entirely here because there is nothing to
          // scroll; companion blocks (api-key warning, first-request
          // error) stack in the same centred column so the layout stays
          // cohesive.
          <div className="absolute inset-x-0 top-[40vh] flex -translate-y-1/2 flex-col items-center gap-3 px-6 text-center text-xs text-muted-foreground">
            <HermesLogo size={72} />
            <p className="max-w-[28ch] leading-relaxed">
              Ask Hermes anything. Messages stay on this device; history
              persists in extension storage.
            </p>
            {error && (
              <ErrorBlock
                error={error}
                onOpenSettings={() => openSettings()}
              />
            )}
          </div>
        ) : (
          <ScrollArea className="h-full min-w-0">
            <div className="min-w-0 space-y-2 p-3">
              {!hasActive ? (
                <EmptyState
                  onNew={() => void newChat()}
                  onOpenHistory={() => setHistoryOpen(true)}
                  hasHistory={sessions.sessions.length > 0}
                />
              ) : (
                <MessageTurns
                  messages={messages}
                  showStreamDetails={showStreamDetails}
                  onOpenAgentDestination={openAgentDestination}
                />
              )}

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
        {(pageError || attachmentError) && (
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
        <input
          ref={fileInputRef}
          type="file"
          multiple={true}
          accept={ATTACHMENT_INPUT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const list = e.target.files;
            if (!list || list.length === 0) return;
            const files = Array.from(list);
            void addFiles(files);
          }}
        />
        {/*
          Cursor-style composer: optional queued turns render in a slim strip
          *above* the bordered box (popup stack). The textarea + action row
          stay inside the rounded frame; focus-within still targets that box.
        */}
        <div
          className={cn(
            "relative flex w-full flex-col",
            dragOver && "rounded-lg ring-2 ring-primary/30",
          )}
          onDragOver={(e) => {
            if (
              e.dataTransfer &&
              Array.from(e.dataTransfer.types || []).includes("Files")
            ) {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragOver(false);
          }}
          onDrop={(e) => {
            if (
              !e.dataTransfer ||
              !Array.from(e.dataTransfer.types || []).includes("Files")
            ) {
              return;
            }
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length > 0) void addFiles(files);
          }}
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
                dragOver && "border-primary/50",
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
        <div
          className={cn(
            "relative flex flex-col rounded-lg border border-input bg-background shadow-sm transition-colors focus-within:border-ring/60",
            (pendingQueue.length > 0 || pendingApprovals.length > 0) &&
              "rounded-t-none",
          )}
        >
          {editingQueueId != null && (
            // Minimal inline hint — just enough to remember the composer
            // is bound to a queue item. Tooltip carries the longer
            // explanation; cancel button is the small ✕.
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
          )}
          {(() => {
            // The live current chip is suppressed when:
            // The pending-page list is now strictly opt-in (click Pin to add
            // a one-shot snapshot of the current tab). No more "live current
            // tab" chip — the agent reads the user's tab on demand via
            // my_browser_active_tab.
            const anyChips =
              pinnedPages.length > 0 || attachments.length > 0;
            if (!anyChips) return null;
            return (
              <div className="flex flex-wrap items-center gap-1 border-b border-border/50 px-2 py-1.5">
                {pinnedPages.map((p) => (
                  <PageChip
                    key={p.uiId}
                    title={p.title}
                    url={p.url}
                    favIconUrl={(p as { favicon?: string }).favicon}
                    onRemove={() => dismissPageChip({ uiId: p.uiId })}
                  />
                ))}
                {attachments.map((a) => (
                  <AttachmentChip
                    key={a.uiId}
                    attachment={a}
                    onRemove={() => removeAttachment(a.uiId)}
                  />
                ))}
              </div>
            );
          })()}
          <Textarea
            ref={composerTextareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              attachmentUploading
                ? t("sidepanel.placeholder.uploading")
                : attachments.length > 0
                  ? t("sidepanel.placeholder.withAttachments")
                  : pinnedPages.length > 0
                    ? t("sidepanel.placeholder.withPinned")
                    : t("sidepanel.placeholder")
            }
            rows={2}
            style={{ maxHeight: COMPOSER_TEXTAREA_MAX_PX }}
            className="min-h-9 resize-none overflow-hidden border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            onPaste={handleComposerPaste}
            onKeyDown={(e) => {
              // Ignore Enter while an IME (e.g. Chinese) is composing — the
              // user may press Enter to commit Latin/pinyin, not to send.
              const ne = e.nativeEvent;
              if (ne.isComposing || e.key === "Process") {
                return;
              }
              if (
                (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
                (e.key === "Enter" && !e.shiftKey && !e.altKey)
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
              <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void openFilePicker()}
                disabled={attachmentBusy || attachmentUploading}
                title={t("sidepanel.attach.tooltip")}
                aria-label={t("sidepanel.attach")}
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  (attachmentBusy || attachmentUploading) &&
                    "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
                )}
              >
                <Paperclip className="h-3 w-3" />
              </button>
              {/*
                Pin: attach the user's current tab as a one-shot snapshot for
                the next message. Cleared after send (the agent reads live
                pages on demand via `my_browser_active_tab` / `read_tab`).
                Re-clicking before send toggles the pin off.
              */}
              <button
                type="button"
                onClick={() => void toggleCurrentPagePin()}
                disabled={pinDisabled}
                aria-pressed={isCurrentPagePinned}
                aria-label={
                  isCurrentPagePinned
                    ? t("sidepanel.pin.unpinAria")
                    : t("sidepanel.pin.pinAria")
                }
                title={
                  pageRestrictedReason && !isCurrentPagePinned
                    ? pageRestrictedReason
                    : isCurrentPagePinned
                      ? t("sidepanel.pin.unpinTooltip")
                      : t("sidepanel.pin.pinTooltip")
                }
                className={cn(
                  "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isCurrentPagePinned
                    // Lightweight "active" state: a translucent foreground
                    // wash instead of the loud primary fill. Reads clearly
                    // as selected without dominating the toolbar.
                    ? "border-foreground/20 bg-foreground/10 text-foreground hover:bg-foreground/15"
                    : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  pinDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
              >
                <Pin
                  className="h-3 w-3"
                  fill={isCurrentPagePinned ? "currentColor" : "none"}
                />
                <span>{t("sidepanel.pin")}</span>
              </button>
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
                  // Mirror Pin's pattern (and its lightweight active
                  // styling): outlined when off, translucent foreground
                  // wash when on. The earlier loud primary fill was too
                  // shouty for a composer-level toggle.
                  "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  showStreamDetails
                    ? "border-foreground/20 bg-foreground/10 text-foreground hover:bg-foreground/15"
                    : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Brain className="h-3 w-3" />
                <span>{t("sidepanel.streamDetails")}</span>
              </button>
              </div>
            </div>
            {busy ? (
              composerHasSendablePayload ? (
                <Button
                  size="icon"
                  onClick={() => void send()}
                  disabled={attachmentUploading || attachmentBusy}
                  title={t("sidepanel.queue.tooltip")}
                  className="h-6 w-6 shrink-0 rounded-full [&_svg]:size-3"
                >
                  <ArrowUp strokeWidth={3} />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  onClick={stop}
                  title={t("sidepanel.stop")}
                  aria-label={t("sidepanel.stop")}
                  className="h-6 w-6 shrink-0 rounded-full"
                >
                  <span
                    aria-hidden
                    className="block h-2 w-2 rounded-[1.5px] bg-current"
                  />
                </Button>
              )
            ) : (
              <Button
                size="icon"
                onClick={() => void send()}
                disabled={
                  (!input.trim() &&
                    !attachments.some((a) => a.path && !a.uploading)) ||
                  attachmentUploading ||
                  attachmentBusy
                }
                title={t("sidepanel.send.tooltip")}
                className="h-6 w-6 shrink-0 rounded-full [&_svg]:size-3"
              >
                <ArrowUp strokeWidth={3} />
              </Button>
            )}
          </div>
        </div>
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center rounded-lg bg-primary/5 text-[12px] font-medium text-primary">
            Drop files to attach
          </div>
        )}
        </div>
      </footer>

      <SessionDrawer
        open={historyOpen}
        sessions={sessions.sessions}
        openTabIds={sessions.openTabIds}
        activeId={sessions.activeId}
        onClose={() => setHistoryOpen(false)}
        onOpen={(id) => void sessions.openTab(id)}
        onRename={(id, title) => void sessions.rename(id, title)}
        onDelete={(id) => void sessions.remove(id)}
      />
    </div>
  );
}
