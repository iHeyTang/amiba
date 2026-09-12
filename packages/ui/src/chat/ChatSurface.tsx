import { useSessionComposerDraft } from "./use-session-composer-draft";
import { useConversationSubmitHandoff } from "./useConversationSubmitHandoff";
import { usePrepareConversationSubmit } from "./conversation-submit";
import { createSurfaceActivity } from "../primitives/surface-activity";
import { InteractionRegion } from "../primitives/interaction-region";
import { EmptyStateVisual } from "../primitives/empty-state-visual";
import type { ToolNavigation } from "./bubble/tool-navigation";
import { usePrepareMarkdownTurn } from "@amiba/markdown";
import { MessageNoticeRendererContext, type MessageNoticeRenderer } from "./bubble/Bubble";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Globe,
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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useT } from "@amiba/i18n";
import {
  getPlatform,
  type AgentModelSelection,
  type StorageChangeMap,
} from "@amiba/app-runtime/platform";
import { useResolvedTheme } from "../theme";
import { AmibaLogo, ScrollArea } from "../primitives";
import { cn } from "../primitives";
import { shortId } from "@amiba/app-runtime/utils";
// Wire-protocol types + engine + helpers — everything that was previously
// imported from extension-local paths now lives in @amiba/app-runtime/core.
import {
  attachmentToBadge,
  classify,
  deleteAttachmentFile,
  formatBytesShort,
  formatFileAttachmentsForPrompt,
  getAgentPresets,
  isAttachmentReadOk,
  normalizeAgentContext,
  readBlobAsAttachment,
  useSessions,
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
  type SnapshotFrame,
  type StreamEvent,
  type UserQuestionRequest,
  type UserQuestionAnswerItem,
} from "@amiba/app-runtime/core";

// Sub-components + helpers + UI types live next to this file in chat-ui.
import { ApprovalBanner } from "./bubble/approval";
import { ClarifyBanner } from "./bubble/clarify";
import { ComposerDockError } from "./ComposerDockSheet";
import { ErrorBlock } from "./bubble/chips";
import {
  AwaitingUserInputContext,
  MessageSourceLabelContext,
  MessageTurns,
  type MessageSourceLabelResolver,
} from "./bubble/Bubble";
import {
  ToolCallSeatProvider,
  type ToolCallSeatRenderer,
} from "./bubble/tool-call-seat";
import {
  QuestionSeat,
  type QuestionSeatRenderer,
} from "./bubble/question-seat";
import { useWorkspacePane } from "./WorkspacePane";
import {
  WorkspaceFileOpenerContext,
  isHtmlPreviewPath,
  resolveWorkspaceFilePath,
  workspaceFileUrl,
  type WorkspaceFileLink,
} from "./workspace-file-links";
import {
  Composer,
  type ComposerDensity,
  type ComposerHandle,
  type ComposerModelPickerRenderer,
  type ComposerPickerOverlayVariant,
  type ComposerPlanSeatRenderer,
} from "./Composer";
import { ConversationTurnRail } from "./ConversationTurnRail";
import { useComposerAttachments } from "./useComposerAttachments";
import { SessionDrawer } from "./SessionDrawer";
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
import {
  settleStreamingMessage,
  withHostAssistantPlaceholder,
  withHostUserMessage,
} from "./internal/host-turn-messages";

import type {
  PendingPromptResult,
  ChatSurfaceCapabilities,
} from "./internal/capabilities";
import type { TriggerProvider } from "./composer/providers/types";
import type { ComposerTriggerRuntime } from "./composer/triggers/contracts";
import { PendingQueueRail } from "./internal/PendingQueueRail";
import { useApprovals } from "./internal/useApprovals";
import { useConversationWorkspace } from "./internal/useConversationWorkspace";
import {
  previewPendingTurn,
  usePendingQueue,
  type PendingChatTurn,
  type RunChatTurnArgs,
} from "./internal/usePendingQueue";
import { useStreamBuffer } from "./internal/useStreamBuffer";

// UiMessage / AssistantTimelineItem / ChatError / COMPOSER_TEXTAREA_MAX_PX
// now live in @amiba/chat-ui (alongside the rendering components).
// Imported below in the consolidated import block.

// PendingChatTurn / previewPendingTurn now live in
// internal/usePendingQueue.ts (the queue subsystem owns its own types +
// helpers). Imported above.

// URL opening stays host-owned so the shared chat surface never acquires
// Electron privileges directly.

// ChatError moved to @amiba/chat-ui (see consolidated import block).

/**
 * Chat state, composer, message rendering, and approvals are shared by the
 * desktop conversation view and Quick Ask.
 */
/**
 * Width preset for the desktop messages column. The composer keeps a fixed
 * cap regardless; only the message flow above it resizes.
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
   * Chat engine the view talks to. Desktop uses IPC to the main-process DSH
   * client and receives DSH lifecycle frames through this contract.
   */
  client: ChatEngineClient;

  /** Optional desktop hand-off and workspace integrations. */
  capabilities?: ChatSurfaceCapabilities;

  /**
   * UI slots for surface-specific React subtrees.
   */
  slots?: {
    /**
     * Rendered when there's no active session. Desktop passes
     * ``<HomeView panelMode />`` here so the empty state looks and
     * behaves like the standalone home page. When omitted, the panel
     * falls back to a built-in greeting + the canonical chat composer
     * centred in the main area.
     */
    emptyState?: ReactNode;
    /**
     * renderSlot-backed model-picker renderer, forwarded to the internal
     * ``<Composer modelPicker>``. Hosts inside a DSH plugin runtime back it
     * with the seat-split official dispatch (`conversation.input.model`
     * for session requests, the vendor `amiba.composer.modelPicker` hero
     * seat for draft requests); hosts without one (Quick-Ask) omit it and
     * the composer renders nothing where the chip would sit.
     */
    modelPicker?: ComposerModelPickerRenderer;
    /**
     * renderSlot-backed dispatch of the official `conversation.input.plan`
     * seat, forwarded verbatim to ``<Composer planSeat>``. Hosts inside a
     * DSH plugin runtime back it with
     * `renderSlot("conversation.input.plan", owner)`; hosts without one
     * omit it and the composer's tool row is byte-identical to before.
     */
    planSeat?: ComposerPlanSeatRenderer;
    /**
     * renderSlot-backed dispatch of the official `conversation.input.overlay`
     * seat (list, session scope, EMPTY owner), forwarded verbatim to
     * ``<Composer inputOverlay>``. Hosts inside a DSH plugin runtime back it
     * with `renderSlot("conversation.input.overlay", {})` — the empty owner
     * share is the whole contract, so an empty object is the faithful
     * dispatch. Hosts without one (Quick-Ask) omit it and the composer card
     * is byte-identical to before.
     */
    inputOverlay?: ReactNode;
    inputAttachments?: import("./Composer").ComposerAttachmentsRenderer;
    inputDock?: ReactNode;
    composerDock?: ReactNode;
    inputLeft?: ReactNode;
    inputRight?: ReactNode;
    /** Session-scoped plugin notices and tool annotations. */
    notice?: MessageNoticeRenderer;
    progress?: () => ReactNode;
    toolNavigation?: ToolNavigation;
    toolAnnotation?: (owner: { callId: string }) => ReactNode;
    /**
     * renderSlot-backed dispatch of the official KEYED `tool.call.toolview`
     * seat, published to every tool row in the conversation. Hosts inside a
     * DSH plugin runtime back it with
     * `renderSlot("tool.call.toolview", owner, { entryKey: owner.toolName,
     * fallback })`; hosts without one omit it and every tool row renders
     * Amiba's own `ToolSpec`-driven chip, which is also the `fallback` of
     * every unclaimed tool name.
     */
    assistantActions?: (messageId: string) => ReactNode;
    turnTail?: (runtimeTurn: number, openFile: (path: string) => void) => ReactNode;
    messageText?: (runtimeTurn:number|undefined,children:ReactNode,openFile:(path:string)=>void,timeline?: readonly import("@amiba/app-runtime/protocol").AssistantTimelineItem[])=>ReactNode;
    timelineRows?: readonly { id: string; seq: number; content: ReactNode; replaceMessageId?: string }[];
    turnTailAnchors?: readonly { runtimeTurn: number; endSeq: number }[];
    toolView?: ToolCallSeatRenderer;
    /**
     * renderSlot-backed dispatch of Amiba's KEYED `amiba.conversation.question`
     * seat, keyed by the first pending question's id; `fallback` is today's
     * `ClarifyBanner`, so every unclaimed question renders unchanged.
     */
    questionSeat?: QuestionSeatRenderer;
  };

  /**
   * Extra @ providers contributed by the desktop host (for example @file).
   * Forwarded verbatim to `<Composer mentionProviders>`.
   * Leave undefined to use only the built-in skills / slash / sessions /
   * personas / channels providers.
   */
  mentionProviders?: TriggerProvider[];
  /**
   * The OFFICIAL input-trigger pipeline, supplied by the DSH plugin host.
   * With it the composer drives the per-session `InputTriggerController` and
   * its menu renders from the shadowed `conversation.input.overlay` seat;
   * without it (Quick-Ask, the browser extension) the composer keeps its
   * surface-local provider registry over the same sources.
   */
  triggerRuntime?: ComposerTriggerRuntime;

  /**
   * Open Settings, optionally at the recovery pane chosen by ErrorBlock.
   * SettingsView hash routing lands directly on models, connection, or logs.
   */
  openSettings: (tab?: string) => void;

  /**
   * Open an agent-destination URL in the user's primary browser.
   */
  openAgentDestination: (url: string) => void | Promise<void>;

  /**
   * Names the producer of a message whose `origin` says a plugin dispatched
   * it. Provided once around the conversation as
   * `MessageSourceLabelContext`, which the user bubble reads. Supplied by
   * ui-shell from the `amiba.message.source` slot; omitted (Quick-Ask, the
   * browser extension) the bubble uses a localized generic source name.
   */
  messageSourceLabel?: MessageSourceLabelResolver;
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

/**
 * Reserve enough scroll space for both sides of an editor height transition.
 * The intrinsic auto-grow target can be shorter than the editor's CSS
 * min-height, so the projected dock height alone is not a safe occlusion
 * boundary. Keeping the larger of the painted and projected heights makes the
 * final conversation row reachable above the floating composer at every
 * frame, including the empty-editor state.
 */
export function measureComposerDockClearance(dock: HTMLElement): number {
  return Math.max(
    Math.ceil(dock.getBoundingClientRect().height),
    measureComposerDockTargetHeight(dock),
  );
}

export default function ChatSurface({
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
  triggerRuntime,
  openSettings,
  openAgentDestination,
  messageSourceLabel,
}: ChatSurfaceProps) {
  // Resolve the shared desktop theme before rendering either main chat or
  // Quick Ask.
  useResolvedTheme();
  const { t } = useT();

  const sessions = useSessions();
  const surfaceActivity = useMemo(() => createSurfaceActivity(sessions.activeId), [sessions.activeId]);
  const hasActive =
    resolveChatSurfaceMode(sessions.activeId) === "conversation";
  const workspacePane = useWorkspacePane();

  const [input, setInput, setSessionInput, composerDraftSource] = useSessionComposerDraft(sessions.activeId);
  const handledNewConversationRequestRef = useRef(newConversationRequestKey);
  const defaultProfileIdRef = useRef("default");
  const [draftAgent, setDraftAgent] = useState<AgentExecutionContext>({
    profileId: "default",
  });
  const currentSessionMeta = sessions.sessions.find(
    (session) => session.id === sessions.activeId,
  );
  const readOnly = currentSessionMeta?.subagentAddress?.mode === "one-shot";
  const effectiveAgent = normalizeAgentContext(
    currentSessionMeta?.agent ?? draftAgent,
  );
  const profileLocked =
    Boolean(currentSessionMeta?.messageCount) ||
    sessions.activeMessages.some((message) => message.role === "user");

  useEffect(() => {
    let alive = true;
    void getAgentPresets().then((result) => {
      if (!alive || !result.ok) return;
      defaultProfileIdRef.current = result.active || "default";
      if (!sessions.activeId) {
        setDraftAgent((current) =>
          current.profileId === "default"
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
  // Set when the Home launcher hands off a prompt through platform storage.
  // We populate the composer
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
  // session id, then binds it before any message reaches DSH.
  const pendingWorkspacePathRef = useRef<string | null>(null);
  // The id-less Home surface can choose from the global DSH catalog. Keep the
  // draft choice until the first submit so the engine can atomically create
  // the real session, bind this model, and only then issue the prompt.
  const pendingModelSelectionRef = useRef<AgentModelSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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
    registerDraftImage: triggerRuntime?.registerDraftImage,
    getSessionId: () => sessions.activeId || draftUploadSessionRef.current,
  });
  const {
    attachments,
    setAttachments,
    attachmentUploading,
    attachmentBusy,
    attachmentError,
    setAttachmentError,
    addFiles,
  } = att;
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

  // A file the agent named in its reply (inline code, or a row on the
  // files-changed card). HTML lands in the embedded browser as a rendered
  // page — that is what "here is your report" means — everything else, and
  // any host without a browser, opens as a file tab.
  const openWorkspaceFile = useCallback(
    (link: WorkspaceFileLink) => {
      if (isHtmlPreviewPath(link.path)) {
        const absolute = resolveWorkspaceFilePath(link.path, workspacePath);
        if (
          absolute &&
          workspacePane.openUrl(workspaceFileUrl(absolute))
        ) {
          return;
        }
      }
      workspacePane.openFile(link.path, link.line);
    },
    [workspacePane, workspacePath],
  );
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
   * Promise plumbing so `runChatTurn` can await a stream owned by the desktop
   * engine. Resolved by the terminal event for this sessionId; left empty
   * when the renderer reopens to an already-running stream (no local
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
   * DSH event persistence and came back without it.
   *
   * Without this cache, the symptom is: send a message → switch to a
   * different session → switch back before the stream finishes →
   * **user bubble vanishes** until a hard refresh (because `saveMessages`
   * is a no-op by design — DSH is the persistence authority — while
   * `loadMessages` reads its event log before the user event has landed).
   * The cache scopes by sessionId so multiple
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
    setActiveTurnId,
    appendApprovalRecord,
    markApprovalOutcome,
    respondToApproval,
    onApprovalRequestEvent,
    onApprovalResolvedEvent,
    reset: resetApprovals,
  } = approvals;
  const [pendingQuestions, setPendingQuestions] = useState<
    UserQuestionRequest[]
  >([]);
  const [clarifyInFlight, setClarifyInFlight] = useState(false);
  const [clarifyError, setClarifyError] = useState<string | null>(null);

  function resetQuestions() {
    setPendingQuestions([]);
    setClarifyInFlight(false);
    setClarifyError(null);
  }

  async function respondToQuestion(answers: UserQuestionAnswerItem[]) {
    const request = pendingQuestions[0];
    if (!request || clarifyInFlight) return;
    if (
      answers.length !== request.questions.length ||
      request.questions.some(
        (question, index) => answers[index]?.id !== question.id,
      )
    ) {
      setClarifyError(t("sidepanel.clarify.sendFailed"));
      return;
    }
    setClarifyInFlight(true);
    setClarifyError(null);
    const result = await client.respondToQuestions(request, answers);
    setClarifyInFlight(false);
    if (!result.ok) {
      setClarifyError(result.error || t("sidepanel.clarify.sendFailed"));
      return;
    }
    setPendingQuestions((current) =>
      current.filter((item) => item.requestId !== request.requestId),
    );
  }

  async function cancelQuestionRequest() {
    const request = pendingQuestions[0];
    if (!request || clarifyInFlight) return;
    setClarifyInFlight(true);
    setClarifyError(null);
    const result = await client.cancelQuestions(request);
    setClarifyInFlight(false);
    if (!result.ok) {
      setClarifyError(result.error || t("sidepanel.clarify.sendFailed"));
      return;
    }
    setPendingQuestions((current) =>
      current.filter((item) => item.requestId !== request.requestId),
    );
  }
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
      const targetHeight = measureComposerDockTargetHeight(dock);
      const nextClearance = measureComposerDockClearance(dock);
      onComposerHeightChange?.(targetHeight);

      if (!hasActive) {
        composerDockHeightRef.current = 0;
        setComposerDockHeight(0);
        return;
      }
      if (nextClearance === composerDockHeightRef.current) return;

      const viewport = conversationViewportRef.current;
      if (viewport) {
        const distanceFromBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        keepConversationPinnedAfterDockResizeRef.current =
          distanceFromBottom <= 24;
      }

      composerDockHeightRef.current = nextClearance;
      setComposerDockHeight(nextClearance);
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
    readOnly,
    sessions,
    client,
    input,
    draftSource: composerDraftSource,
    submitComposer: () => composerRef.current?.submit?.() ?? false,
    resolveQueuedDraft: (draft, signal) => composerRef.current?.resolveQueuedDraft?.(draft, signal)
      ?? Promise.reject(new Error("Input editor is not mounted")),
    setInput,
    attachments,
    setAttachments,
    setAttachmentError,
    attachmentUploading,
    setPendingSourceApp,
    busy,
    markCurrentAssistantStopped: () => markCurrentAssistantStopped(),
    rejectPendingTurn: (sid, err) => rejectPendingTurn(sid, err),
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
  const queueDrainRef = useRef({ sessionId: sessions.activeId, drain: queueHook.drainHead });
  queueDrainRef.current = { sessionId: sessions.activeId, drain: queueHook.drainHead };

  // Pick up a prompt handed off from the new-tab Home launcher or from
  // an external surface (Quick-Ask Spotlight selection, Region Snip
  // screenshot, `amiba://...` URL, Unix socket inbox). Each surface
  // writes `{ text?, attachments?, sourceApp? }` into storage and opens
  // the chat view; we drain that key here, prefill the composer with
  // whichever fields are populated, and flag the turn for auto-send.
  // The host clears the storage key atomically so renderer remounts do not
  // resubmit the same prompt.
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
    void drain().then((payload: PendingPromptResult | null) => {
      if (payload == null) return;
      const text = payload.text?.trim() ?? "";
      const incoming = payload.attachments ?? [];
      const promotedAttachments: Attachment[] = incoming.map((a) => ({
        uiId: a.uiId,
        name: a.name,
        mime: a.mime,
        size: a.size,
        kind: a.kind,
        attachmentId: a.attachmentId,
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
      if (payload.modelSelection) {
        pendingModelSelectionRef.current = payload.modelSelection;
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
  // Chat engine subscription/snapshot/event handling.
  //
  // The agent loop lives in managed DSH behind the desktop engine. The
  // renderer posts user input and receives `StreamEvent`s over its IPC
  // subscription. Snapshot is the recovery path — sent on `subscribe` so a
  // freshly mounted renderer (or one
  // switching to a session that was streaming in another tab) can rebuild
  // the in-flight assistant bubble from accumulated runtime state.
  //
  // The accumulator/flush/timeline helpers used to live here as inline
  // function declarations; they're now on `stream.*` (see
  // `useStreamBuffer`). The handlers below call `stream.onChunk`,
  // `stream.onReasoning`, etc.
  // -------------------------------------------------------------------------

  function handleSnapshot(frame: SnapshotFrame): void {
    surfaceActivity.snapshot(frame);
    const { sessionId, kind } = frame;
    if (sessionId !== sessions.activeId) return;

    if (frame.kind === "absent") {
      // The engine has no active run for this session. Two situations land here:
      //   1. User switched to a fresh / never-submitted session
      //      → panel-level state must drop so the composer reflects
      //        the new session.
      //   2. A subscribe-snapshot round-trip raced ahead of our own
      //      `submit` (typical of the new-tab → chat handoff). The
      //      the engine will produce real state imminently and emit `begin`,
      //      so suppress hygiene here to avoid a busy/UI flicker.
      // `pendingTurnRef` is set the instant runChatTurn posts submit,
      // so it's the authoritative "we're mid-submission" signal.
      if (pendingTurnRef.current?.sessionId === sessionId) return;
      setBusy(frame.hostRunning ?? false);
      resetApprovals();
      resetQuestions();
      // Interaction waits outlive turn state: DSH keeps unanswered
      // questions/approvals pending server-side, and the engine's ledger
      // carries them into absent snapshots — so a session reopened after
      // a reload still shows its blocking banner.
      if (frame.pendingApprovals?.length) {
        setPendingApprovals(frame.pendingApprovals);
      }
      if (frame.pendingQuestions?.length) {
        setPendingQuestions(frame.pendingQuestions);
      }
      return;
    }

    // Live / interrupted / completed — engine state carries information
    // the panel may not yet have in ``prev`` (the messages loaded from
    // SessionDB). The three kinds have different invariants:
    //
    //   - "completed": SessionDB has the FULL final assistant turn
    //     (DSH commits before the stream resolves). ``prev``
    //     already contains it. The engine's in-memory runtime
    //     ``assistantUiId`` is its own ephemeral id (``shortId("a")``)
    //     which never matches the runtime sequence ids from ``loadMessages``
    //     produces — synthesizing would APPEND a duplicate bubble
    //     ("agent 回复重复一次" report). The only thing we still need
    //     from the snapshot is panel-only UI metadata
    //     (``agentFinalUrl`` / ``agentFinalTitle``) that doesn't
    //     round-trip through SessionDB — overlay onto the last
    //     assistant message instead.
    //   - "live": stream is still in flight. Panel may have closed
    //     before DSH committed the assistant placeholder, so
    //     synthesis IS the right thing — there's nothing in ``prev``
    //     to update yet.
    //   - "interrupted": engine crashed mid-stream. DSH history has
    //     whatever events were committed before the failure;
    //     the engine's state has the (potentially longer) text it had
    //     accumulated locally. Overlay onto the matching bubble if
    //     present, else synthesize the partial text. The actionable
    //     ErrorBlock below is the sole runtime-error indicator: encoding
    //     another `[interrupted]` marker into transient message content
    //     made the label jump to the latest turn after a reload.
    const { state } = frame;
    stream.hydrateFromSnapshot(state);
    setBusy(frame.hostRunning ?? state.streaming);
    setPendingApprovals(state.pendingApprovals ?? []);
    setPendingQuestions(state.pendingQuestions ?? []);
    setActiveTurnId(state.turnId ?? null);

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
        assistantMessageId: state.assistantMessageId,
        runtimeTurn: state.runtimeTurn,
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
      // The matching user bubble normally comes from `loadMessages`.
      // On a switch-back during streaming, that DSH history read can race
      // the user event append and return without it, leaving the renderer with
      // only
      // the assistant bubble (or nothing) until the next refresh.
      // Pull the user bubble out of `inFlightTurnByIdRef` — the cache
      // we populated in `runChatTurn` before posting — when the
      // snapshot's assistantUiId matches our cache entry AND ``prev``
      // doesn't already contain a user message with the same content
      // near the tail (loaded-from-DSH dedup).
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
    setBusy(false);
    inFlightTurnByIdRef.current.delete(sessionId);
    resolvePendingTurn(sessionId);
  }

  /**
   * Seal whichever assistant message is currently streaming with the
   * `[stopped]` suffix, clear all the streaming-side refs, persist, and
   * flip `busy` off. Used by `handleStreamAborted` (engine-confirmed abort)
   * and `sendQueueItemNow` (local pre-emption — the UI does not wait for the
   * engine echo). Idempotent: if there's
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

  function handleStreamAborted(
    sessionId: string,
    assistantUiId?: string,
  ): void {
    // A NAMED bubble that isn't the one being streamed here is a displaced
    // host-started run: the engine settling its assistant bubble as the
    // local turn that replaced it begins. Stop that bubble spinning and
    // leave everything about the local turn — the primed accumulators, the
    // pending-turn promise, `busy` — completely alone.
    if (
      assistantUiId &&
      sessionId === sessions.activeId &&
      assistantUiId !== stream.getCurrentAssistantUiId()
    ) {
      sessions.setActiveMessages((prev) =>
        settleStreamingMessage(prev as UiMessage[], assistantUiId),
      );
      return;
    }
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
    resetQuestions();
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
    surfaceActivity.event(sessionId, event);
    if (event.kind === "toolProgress") {
      workspacePane.observeToolEvent(event.event, sessionId);
    }
    // Runtime-generated titles apply to ANY session's rail row, active or
    // not; applyAutoTitle respects manual renames.
    if (event.kind === "sessionTitle") {
      void sessions.applyAutoTitle(sessionId, event.title);
      return;
    }
    if (sessionId !== sessions.activeId) {
      // Terminal events for non-active sessions still need to settle the
      // local awaiter (if any) — otherwise `runChatTurn` for a backgrounded
      // tab would never resolve.
      if (event.kind === "done")
        handleStreamDone(sessionId, event.agentFinalUrl, event.agentFinalTitle);
      else if (event.kind === "aborted")
        handleStreamAborted(sessionId, event.assistantUiId);
      else if (event.kind === "error") handleStreamError(sessionId, event);
      return;
    }
    switch (event.kind) {
      case "assistantMessage": {
        const assistantUiId = stream.getCurrentAssistantUiId();
        if (assistantUiId) sessions.setActiveMessages(prev => (prev as UiMessage[]).map(message =>
          message.uiId === assistantUiId ? { ...message, assistantMessageId: event.messageId } : message));
        break;
      }
      case "begin":
        setBusy(true);
        stream.onBegin(event.assistantUiId);
        // A turn the HOST started (a plugin dispatching on the user's
        // behalf) has no local `runChatTurn` to have appended the assistant
        // placeholder first, and the chunk/verbose flushes only ever UPDATE
        // an existing bubble. Append one when it is missing; a locally
        // submitted turn already has it and this is a no-op. The check runs
        // inside the updater so it reads the queued state, not the render
        // that fired the event.
        sessions.setActiveMessages((prev) =>
          withHostAssistantPlaceholder(
            prev as UiMessage[],
            event.assistantUiId,
          ),
        );
        break;
      case "userMessage": {
        // A message a plugin put into this session. `uiId` is the same id
        // the durable-log projection derives, so re-reading history (a tab
        // switch, a reload) lands on the same bubble instead of a second
        // one — and an event that arrives after the read is a no-op.
        const { uiId, content, sentAt, origin, notice } = event;
        sessions.setActiveMessages((prev) => {
          const arr = prev as UiMessage[];
          const next = withHostUserMessage(arr, {
            uiId,
            content,
            sentAt,
            origin,
            notice,
          });
          if (next !== arr) void sessions.touchSession(sessionId, next);
          return next;
        });
        break;
      }
      case "assistantTextSource":
        stream.onAssistantTextSource(event);
        break;
      case "chunk":
        stream.onChunk(event.text, event.runtimeStep);
        break;
      case "reasoning":
        stream.onReasoning(event.text);
        break;
      case "toolCalls":
        stream.onToolCalls(event.calls);
        break;
      case "toolProgress":
        stream.onToolProgress(event.event);
        break;
      case "compaction":
        stream.onCompaction(event.event);
        break;
      case "session":
        if (event.sessionId && event.sessionId !== sessionId) {
          console.warn(
            "[chat] DSH returned session id %s but we expected %s; ignoring.",
            event.sessionId,
            sessionId,
          );
        }
        break;
      case "turn": {
        setActiveTurnId(event.turnId || null);
        const assistantUiId = stream.getCurrentAssistantUiId();
        if (assistantUiId) sessions.setActiveMessages(prev => (prev as UiMessage[]).map(message =>
          message.uiId === assistantUiId ? { ...message, runtimeTurn: event.runtimeTurn } : message));
        break;
      }
      case "approvalRequest":
        onApprovalRequestEvent(event.request);
        break;
      case "approvalResolved":
        onApprovalResolvedEvent(event.approvalId);
        break;
      case "questionRequest":
        setPendingQuestions((current) => [
          ...current.filter(
            (item) => item.requestId !== event.request.requestId,
          ),
          event.request,
        ]);
        setClarifyError(null);
        break;
      case "questionResolved":
        setPendingQuestions((current) =>
          current.filter((item) => item.requestId !== event.requestId),
        );
        setClarifyInFlight(false);
        setClarifyError(null);
        break;
      case "done":
        stream.finishCompactions();
        handleStreamDone(sessionId, event.agentFinalUrl, event.agentFinalTitle);
        break;
      case "aborted":
        stream.finishCompactions();
        handleStreamAborted(sessionId, event.assistantUiId);
        break;
      case "error":
        stream.finishCompactions();
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

  // One stable subscription to the managed DSH engine over desktop IPC.
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

  // Auto-grow for the textarea now lives inside <Composer />. The
  // local effect that used to run here was duplicated logic — the
  // shared component takes care of it on every value/maxTextareaPx
  // change.

  // Lifecycle of an assistant bubble is owned by DSH-backed engine snapshots.
  // The UI never infers a durable run state from the volatile `streaming` flag.

  // Auto-scroll on new content.
  useEffect(() => {
    const viewport = conversationViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [sessions.activeMessages]);

  // Session switch: drop panel-local stream accumulators and compose-time
  // attachments. The previous session's DSH turn keeps running; switching
  // back re-subscribes and rebuilds local state from the engine snapshot.
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
        resetQuestions();
        // The top-level recovery card belongs to the outgoing session.
        // The incoming snapshot will restore its own error, if any.
        setError(null);
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

  // (Re)subscribe whenever the active tab flips. The engine dedupes
  // subscriptions; calling subscribe also re-delivers a snapshot, which is
  // how we recover an in-flight stream when the user switches back to a tab
  // that was streaming in the background. Deliberately AFTER the
  // session-switch reset effect above: snapshots are delivered
  // synchronously, so subscribing first would let the reset wipe the
  // pending questions/approvals the snapshot just restored.
  useEffect(() => {
    if (!sessions.ready || !sessions.activeId) return;
    client.subscribe(sessions.activeId);
  }, [client, sessions.ready, sessions.activeId]);

  // Per-session pendingQueue persistence (load on activate, save on
  // change, hydration-guarded) is owned by `usePendingQueue`.

  const prepareMarkdownTurn = usePrepareMarkdownTurn();
  const prepareConversationSubmit = usePrepareConversationSubmit();
  const handoffConversationSubmit = useConversationSubmitHandoff({
    activeId: sessions.activeId,
    prepare: prepareConversationSubmit,
    refresh: sessions.refresh,
    open: sessions.openTab,
    run: (args: RunChatTurnArgs) => runChatTurn(args),
  });


  async function runChatTurn(args: RunChatTurnArgs): Promise<void> {
    const { text, attachments: attachmentsForTurn } = args;
    const restoreDraft = () => {
      if (args.draft) composerDraftSource.setParts(args.draft.parts);
      else setInput(text);
    };
    if (readOnly) {
      restoreDraft();
      setAttachments(attachmentsForTurn);
      return;
    }

    setError(null);
    try {
      if (await handoffConversationSubmit(args)) return;
    } catch (error) {
      restoreDraft();
      setAttachments(attachmentsForTurn);
      setError({ message: error instanceof Error ? error.message : String(error), source: "run" });
      return;
    }

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
          setSessionInput(sessionId, text, args.draft);
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
    // message or starting DSH. Unbound sessions resolve to Amiba's $HOME
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
        setSessionInput(sessionId, text, args.draft);
        setAttachments(attachmentsForTurn);
        return;
      }
    }

    // Attachment metadata is inlined into the text for durable history and
    // tool routing. The engine additionally sends supported raster images as
    // native DSH image parts; text/PDF bytes stay behind the capability
    // plugin's path-confined tools.
    const attachmentsForSend = attachmentsForTurn.filter(
      (a) => a.attachmentId && !a.uploading,
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

    const turnIndex = (sessions.activeMessages as UiMessage[]).filter(
      (message) => message.role === "user",
    ).length;
    const userMsg: UiMessage = {
      uiId: shortId("u"),
      role: "user",
      content: text,
      sentAt: Date.now(),
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
    // beats DSH's event append. Cleared by the terminal
    // event handlers (done / aborted / error).
    inFlightTurnByIdRef.current.set(sessionId, {
      user: userMsg,
      assistantUiId: assistantMsg.uiId,
    });
    // Persist immediately so a refresh between bubble-append and the
    // first engine echo doesn't lose the user message. The standard
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

    // Snapshot the history we're sending so we don't accidentally include
    // the empty assistant placeholder we just appended.
    const baseMessages = (sessions.activeMessages as UiMessage[]).map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    }));
    // The attachment blocks no longer merge into the user's text: they
    // travel as `attachmentPrompt` and become their own prompt part in the
    // engine, so what history stores as the user message IS what the user
    // typed. (The merged form survives in old sessions; the reload path
    // still splits it.)
    const history: ChatMessage[] = [
      ...baseMessages,
      {
        role: userMsg.role,
        content: userMsg.content,
      },
    ];

    // Prime the renderer accumulators before submitting so an immediate DSH
    // event always finds populated state to mutate. Engine snapshots remain
    // the authoritative recovery path after remounts.
    stream.prime(assistantMsg.uiId);

    let submitted = false;
    try {
      // Create the recovery point before DSH can dispatch a mutating tool.
      await workspacePane.beginTurn(turnIndex);
      await prepareMarkdownTurn(sessionId);
      const modelSelection = pendingModelSelectionRef.current;
      pendingModelSelectionRef.current = null;
      await new Promise<void>((resolve, reject) => {
        pendingTurnRef.current = { sessionId, resolve, reject };
        try {
          client.submit({
            sessionId,
            sessionTitle: sessions.sessions.find(
              (session) => session.id === sessionId,
            )?.title,
            assistantUiId: assistantMsg.uiId,
            history,
            ...(fileAttachmentBlock
              ? { attachmentPrompt: fileAttachmentBlock }
              : {}),
            ...(attachmentsForSend.length > 0
              ? {
                  attachments: attachmentsForSend.map((attachment) => ({
                    name: attachment.name,
                    mime: attachment.mime,
                    size: attachment.size,
                    kind: attachment.kind,
                    attachmentId: attachment.attachmentId as string,
                  })),
                }
              : {}),
            agent: agentForTurn,
            ...(modelSelection ? { modelSelection } : {}),
          });
          submitted = true;
        } catch (e) {
          pendingTurnRef.current = null;
          reject(e as Error);
        }
      });
    } catch (e) {
      const err = e as Error;
      // Before dispatch there is no engine turn to emit a terminal event.
      // Settle the placeholder and surface preparation / submit failures here.
      if (!submitted) {
        handleStreamError(sessionId, {
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
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
        const current = queueDrainRef.current;
        if (current.sessionId === sessionId) current.drain();
      }
    }
  }

  // The queue actions (send / stop / sendNow / edit / cancelEdit /
  // remove / drainHead) and the per-session persistence effects all
  // live in `usePendingQueue` — destructured above as `queueHook`.
  // `sendRef` is still here because the auto-send useEffect wants to
  // call the latest `send` closure without listing it as a dep.
  sendRef.current = send;

  const resolveUserMessageId = useCallback(
    async (message: UiMessage, userOrdinal: number): Promise<number> => {
      if (typeof message.runtimeSeq === "number") return message.runtimeSeq;
      const resolved = await sessions.resolveUserMessageId(
        sessions.activeId,
        userOrdinal,
      );
      if (resolved == null) {
        throw new Error(t("sidepanel.message.notPersisted"));
      }
      return resolved;
    },
    [sessions, t],
  );

  const branchUserMessage = useCallback(
    async (message: UiMessage, userOrdinal: number) => {
      if (!sessions.activeId || busy) return;
      try {
        const sourceSessionId = sessions.activeId;
        const messageId = await resolveUserMessageId(message, userOrdinal);
        const sourceWorkspace =
          await getPlatform().workspaces?.getCurrent(sourceSessionId);
        const branchId = await sessions.branchSession(
          sourceSessionId,
          messageId,
        );
        if (sourceWorkspace) {
          await getPlatform().workspaces?.bind(branchId, sourceWorkspace);
        }
      } catch (cause) {
        setError({
          message: cause instanceof Error ? cause.message : String(cause),
          source: "run",
        });
      }
    },
    [busy, resolveUserMessageId, sessions],
  );

  /**
   * Append (or refresh) the persistent approval record on whichever
   * assistant message is currently streaming. Idempotent: re-emits of
   * the same approval (e.g. DSH retry, renderer reopen during a still-
   * pending approval) overwrite the existing record rather than
   * stacking duplicates. Skipped silently when there's no active
   * assistant message — DSH shouldn't fire an approval outside
   * a turn, but we don't want to crash if it does.
   */
  // Approval-flow helpers (appendApprovalRecord / markApprovalOutcome /
  // respondToApproval) and the per-card in-flight tracker now live in
  // `useApprovals` — see destructure near the top of the component.

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
    resetQuestions();
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
  const restorableTurnOrdinals = useMemo(
    () =>
      new Set(
        workspacePane.checkpoints
          .filter(
            (checkpoint) =>
              checkpoint.kind === "turn-start" &&
              checkpoint.hasChanges &&
              checkpoint.complete !== false &&
              typeof checkpoint.turnIndex === "number",
          )
          .map((checkpoint) => checkpoint.turnIndex as number),
      ),
    [workspacePane.checkpoints],
  );
  const restoreWorkspaceBeforeTurn = useCallback(
    async (_message: UiMessage, userOrdinal: number) => {
      if (!window.confirm(t("sidepanel.message.restoreWorkspaceConfirm"))) {
        return;
      }
      try {
        setWorkspaceError(null);
        await workspacePane.restoreBeforeTurn(userOrdinal);
      } catch (cause) {
        setWorkspaceError(
          cause instanceof Error ? cause.message : String(cause),
        );
      }
    },
    [setWorkspaceError, t, workspacePane],
  );
  const showTurnRail = messages.some((message) => message.role === "user");
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

  // Composer JSX shared by the bottom dock and the centred empty
  // state. Most hosts still choose one branch or the other; Quick Ask opts
  // into the persistent dock path so React keeps this exact subtree mounted
  // while the first session is created or New chat returns to empty.
  const canSubmitDraft = (text: string) => !readOnly && text.trim().length > 0 && !attachmentUploading && !attachmentBusy;
  const composerNode = (
    <Composer
      ref={composerRef}
      disabled={readOnly}
      value={input}
      draftSource={composerDraftSource}
      onChange={setInput}
      onSubmit={(text) => {
        void send(text);
      }}
      busy={busy}
      onAbort={stop}
      autoFocus={composerAutoFocus}
      canSubmit={
        // Text is required, with or without attachments: an attachment-only
        // send has no user words to anchor the turn, and rather than the app
        // inventing a stand-in downstream, sending is simply not enabled
        // until something is typed.
        canSubmitDraft(input)
      }
      canSubmitDraft={canSubmitDraft}
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
      modelPicker={
        slots?.modelPicker ? { render: slots.modelPicker } : undefined
      }
      approvalModePicker
      planSeat={slots?.planSeat}
      inputOverlay={slots?.inputOverlay}
      inputAttachments={slots?.inputAttachments}
      inputDock={slots?.inputDock}
      composerDock={slots?.composerDock}
      inputLeft={slots?.inputLeft}
      inputRight={slots?.inputRight}
      permissionSessionId={sessions.activeId}
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
      mentionProviders={mentionProviders}
      triggerRuntime={triggerRuntime}
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
    />
  );

  return (
    <InteractionRegion activity={surfaceActivity.activity} activityTitle={currentSessionMeta?.title}
      className={cn(
        "relative flex flex-col bg-background text-foreground",
        // The surface is mounted inside a flex column and consumes the remaining
        // space (the host already places a top-bar sibling above us, so
        // `h-full` would overflow by the bar's height and spill a page-
        // level scrollbar — `flex-1 min-h-0` makes us share the column
        // honestly).
        //
        // ``composer-only`` empty state is content-sized so a host like
        // the Quick-Ask popup can shrink its window to the composer's
        // natural height; without this it'd collapse to zero because
        // the popup body has no explicit height in compact mode.
        expandComposerArea ? "min-h-0 flex-1" : "",
        surfaceClassName,
      )}
    >
      {/*
        The fixed strip stays outside the ScrollArea so a sticky user bubble
        lands a few pixels below the host header instead of butting against it.
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
                  {composerNode}
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
                <div className="flex flex-col items-center gap-2 text-center">
                  <EmptyStateVisual scene="conversation"><AmibaLogo size={56} /></EmptyStateVisual>
                  <p className="text-balance text-sm font-normal leading-6 text-muted-foreground">
                    {t("newtab.subtitle")}
                  </p>
                </div>
                <div className={cn("w-full", "max-w-2xl")}>{composerNode}</div>
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
                {/* The keyed tool-view seat reaches the tool rows from here:
                    the renderer arrives as an explicit render prop (like the
                    composer seats) and this is only the last hop down to
                    ToolChip. `cwd` is the conversation's workspace binding —
                    the `cwd` member of the official owner share. */}
                <MessageNoticeRendererContext.Provider value={slots?.notice}>
                <ToolCallSeatProvider
                  navigation={slots?.toolNavigation}
                  activity={slots?.toolAnnotation}
                  render={slots?.toolView}
                  cwd={workspacePath}
                >
                  {/* An open interaction wait keeps the narration before
                      the pause out of the process fold — see
                      AwaitingUserInputContext. */}
                  <AwaitingUserInputContext.Provider
                    value={
                      pendingQuestions.length > 0 || pendingApprovals.length > 0
                    }
                  >
                    {/* Attribution for plugin-dispatched user messages.
                        Provided here rather than drilled through
                        MessageTurns/UserStickyBubble: it is one shell-wide
                        lookup that every bubble reads and nothing between
                        here and the bubble has any use for. */}
                    <MessageSourceLabelContext.Provider
                      value={messageSourceLabel}
                    >
                      <WorkspaceFileOpenerContext.Provider
                        value={
                          workspacePane.enabled ? openWorkspaceFile : undefined
                        }
                      >
                        <MessageTurns
                          assistantActions={slots?.assistantActions}
                          messageText={slots?.messageText}
                          turnTail={slots?.turnTail}
                          timelineRows={slots?.timelineRows}
                          turnTailAnchors={slots?.turnTailAnchors}
                          openTurnFile={path => {
                            if (path === ".") {
                              if (!workspacePane.files || !sessions.activeId) throw new Error("Workspace folder access is unavailable.");
                              return workspacePane.files.openExternal(sessions.activeId, path);
                            }
                            return openWorkspaceFile({ path });
                          }}
                          sessionId={sessions.activeId ?? undefined}
                          messages={messages}
                          onReviewWorkspaceChanges={
                            workspacePane.enabled
                              ? workspacePane.openReview
                              : undefined
                          }
                          restorableTurnOrdinals={restorableTurnOrdinals}
                          onRestoreBeforeTurn={restoreWorkspaceBeforeTurn}
                          onOpenAgentDestination={openAgentDestination}
                          onBranchUserMessage={branchUserMessage}
                        />
                        {slots?.progress?.()}
                      </WorkspaceFileOpenerContext.Provider>
                    </MessageSourceLabelContext.Provider>
                  </AwaitingUserInputContext.Provider>
                </ToolCallSeatProvider>
                </MessageNoticeRendererContext.Provider>

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
          data-composer-dock=""
          style={{ paddingTop: "calc(8px + var(--amiba-companion-clearance, 0px))" }}
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
            !composerDockInEmptyHost && "mx-auto w-full max-w-3xl",
          )}
        >
          {/* Everything docked above the composer — errors, approvals,
          questions — shares the ComposerDockSheet toaster chrome; sheets
          stack and each tucks under the next. Queue entries share the
          composer's context rail with its immutable workspace tab. */}
          <div
            className={cn(
              "relative flex w-full flex-col",
              att.dragOver && "rounded-lg ring-2 ring-primary/30",
            )}
          >
            {hasActive && attachmentError && (
              <ComposerDockError
                dismissLabel={t("sidepanel.permission.dismissError")}
                message={attachmentError}
                onDismiss={() => setAttachmentError(null)}
              />
            )}
            {hasActive && workspaceError && (
              <ComposerDockError
                dismissLabel={t("sidepanel.permission.dismissError")}
                message={workspaceError}
                onDismiss={() => setWorkspaceError(null)}
              />
            )}
            {hasActive && pendingApprovals.length > 0 && (
              <ApprovalBanner
                approvals={pendingApprovals}
                inFlight={approvalInFlight}
                error={approvalError}
                onRespond={respondToApproval}
                onDismissError={() => setApprovalError(null)}
              />
            )}
            {hasActive && pendingQuestions.length > 0 && (
              <QuestionSeat
                fallback={
                  <ClarifyBanner
                    error={clarifyError}
                    inFlight={clarifyInFlight}
                    onCancel={() => void cancelQuestionRequest()}
                    onRespond={(answers) => void respondToQuestion(answers)}
                    request={pendingQuestions[0]}
                  />
                }
                owner={{
                  request: pendingQuestions[0],
                  inFlight: clarifyInFlight,
                  error: clarifyError,
                  respond: (answers) => void respondToQuestion(answers),
                  cancel: () => void cancelQuestionRequest(),
                }}
                render={slots?.questionSeat}
              />
            )}
            {composerNode}
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
        onRefresh={() => void sessions.refresh()}
      />
    </InteractionRegion>
  );
}
