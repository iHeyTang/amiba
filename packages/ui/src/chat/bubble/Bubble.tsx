import { useConversationTurnWindow } from "../use-conversation-turn-window";
import type { AssistantTimelineItem, MessageAttachment } from "@amiba/app-runtime/protocol";
import { toolCallTreeContains } from "./nested-tool-calls";
import { toolCallBlockFromProgress } from "./tool-call-block";
import { WorkbenchViewBoundary } from "../workbench-extensions";
import { messageTextTimeline, joinTextSources, sliceTextSources, timelineTextSource, thinkingBodySource, type TextSourceRange } from "../text-source-ranges";
import { WorkspaceMarkdown } from "../workspace-file-links";
import { CompactionRow } from "./CompactionRow";
import type { CompactionProgress } from "@amiba/app-runtime/protocol";
import { Fragment } from "react";
import { ToolRowFrame } from "./tool-row-frame";
import { useToolCallSeat } from "./tool-call-seat";
import type { NoticeReference } from "@amiba/app-runtime/protocol";
import type { ApprovalRecord, ToolProgress } from "@amiba/app-runtime/core";
import { ReferenceText } from "../../reference-request";
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../primitives";
import {
  ArrowRight,
  Repeat2,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileDiff,
  GitFork,
  Undo2,
} from "lucide-react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChatMarkdown as Streamdown } from "@amiba/markdown";
import { windowTurns } from "../turn-window";
import { useT } from "@amiba/i18n";

import {
  formatMessageTime,
  type TimeFormatPreference,
  useStoredTimeFormatPreference,
} from "../../time-format";
import {
  bubbleTextContent,
  stripManagedResourceContext,
  splitThinkingFromBody,
} from "../internal/helpers";
import {
  CAPPED_HEIGHT_CLASS,
  CAPPED_HEIGHT_PX,
  EXPANDED_MAX_HEIGHT_CLASS,
  type UiMessage,
} from "../internal/types";
import { splitTrailingTextRun } from "../internal/turn-presentation";
import { ApprovalRecordChip } from "./approval";
import { AgentDestinationChip, AttachmentBadgeView } from "./chips";
import { AttachmentGallery, type AttachmentGalleryItem } from "../attachment-gallery";
import { ToolChip } from "./tool-chip";
import { hasToolDetail } from "./tool-presentation";
import { CodeEvidence } from "./tool-evidence";
import {
  compactWorkspacePath,
  parseWorkspaceReview,
  workspaceReviewResourceFromEvents,
  type WorkspaceReviewResource,
} from "../workspace-review";
import {
  chatMarkdownComponents,
  useWorkspaceFileOpener,
} from "../workspace-file-links";

/**
 * Resolves the plugin id on a message's `origin` to a name to show the user.
 * Returning `undefined` (nothing registered that id) falls back to rendering
 * a localized generic name, keeping internal identifiers out of the conversation.
 *
 * Supplied by the shell from the `amiba.message.source` slot and provided
 * once around the conversation by `ChatSurface`; a bubble rendered without a
 * provider uses the same readable fallback.
 */
export type MessageSourceLabelResolver = (
  pluginId: string,
) => string | undefined;

export interface MessageNoticeOwner { source: string; summary: string; body: string; reference?: NoticeReference }
export type MessageNoticeRenderer = (owner: MessageNoticeOwner, fallback: ReactNode) => ReactNode;
export const MessageNoticeRendererContext = createContext<MessageNoticeRenderer | undefined>(undefined);

export const MessageSourceLabelContext = createContext<
  MessageSourceLabelResolver | undefined
>(undefined);

/**
 * "The session is currently paused on a user interaction" — an open
 * ask-user question or an undecided approval. The HOST that owns pending
 * state (ChatSurface) provides it; the bubble only consumes it to decide
 * whether the narration before the pause is still the user's answering
 * basis (kept visible) or already ordinary process content (folded), and
 * to keep the trailing "working" indicator quiet while nothing is running.
 * Tools never register here: pausing through the official interaction
 * seams (ctx.userQuestions, approvals) IS the declaration.
 */
export const AwaitingUserInputContext = createContext(false);

/**
 * The tail of a turn that is still running. Between the model finishing a
 * line of prose and its next tool call landing (generating a large `write`
 * body can take a long while), no new event reaches the transcript: the
 * process row already reads as completed ("worked for 14s") and the text
 * sits still, so without this line the only sign of life is the composer's
 * stop button. Rendered after settled body text whenever the message is
 * still streaming; the empty-stream and tools-only states have their own
 * pulsing labels and never reach it.
 */
function TurnRunningIndicator() {
  const { t } = useT();
  return (
    <div
      data-testid="turn-running"
      className="inline-flex min-h-7 items-center px-1.5 text-[11px] text-muted-foreground"
      aria-live="polite"
    >
      <span className="agent-thinking-text">
        {t("sidepanel.trace.working")}
      </span>
    </div>
  );
}

/**
 * One collapsed row for a message that ACCOUNTS for something rather than
 * saying it — DSH's `notice` form (a steward task report, a guard's reminder
 * to the model). The producer wrote the one-line `summary` for exactly this
 * row, so collapsed it needs nothing else; expanding reveals the raw body
 * the same way an expanded tool-call result does — plain preformatted text,
 * never markdown. A notice is a machine account (a status line the model
 * happens to read verbatim), not prose somebody composed for a reader: a
 * bare `---` under a title line is legitimate account text, but a markdown
 * renderer reads it as a setext heading underline and blows it up into a
 * giant bold line, which is exactly the bug this avoids.
 *
 * Deliberately the same quiet shape as the execution-summary row: a notice
 * is a footnote to the conversation, not a turn in it.
 */
function ModelChangeNotice({ from, to }: { from: string; to: string }) {
  const { language } = useT();
  const zh = language === "zh-CN";
  const [expanded, setExpanded] = useState(false);
  const modelName = (value: string) => value.slice(value.indexOf("/") + 1);
  return <div data-background-surface="model-notice" data-testid="model-change-notice" className="w-fit max-w-full min-w-0 text-xs">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
      className="flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-chat-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      <Repeat2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 text-muted-foreground">{zh ? "模型切换" : "Model switched"}</span>
      <span className="min-w-0 truncate text-foreground/75" title={from}>{modelName(from)}</span>
      <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-foreground" title={to}>{modelName(to)}</span>
      <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
    </button>
    {expanded && <div className="space-y-1 px-3 pb-2 text-xs leading-5 text-foreground/80">
      <p className="break-all">{from} → {to}</p>
      <p>{zh ? "此处之前的回复由原模型生成，后续对话将使用新模型。" : "Earlier replies were generated by the previous model. The conversation continues with the new model."}</p>
    </div>}
  </div>;
}

function MessageNoticeRow({
  summary,
  label,
  body,
}: {
  summary: string;
  /** The producer's display name; empty when the message named no plugin. */
  label: string;
  body: string;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const hasBody = body.trim().length > 0;

  return (
    <div className="min-w-0 text-sm" data-testid="message-notice">
      <button
        type="button"
        disabled={!hasBody}
        aria-expanded={hasBody ? expanded : undefined}
        title={
          hasBody
            ? expanded
              ? t("sidepanel.trace.collapseDetails")
              : t("sidepanel.trace.expandDetails")
            : undefined
        }
        onClick={() => hasBody && setExpanded((value) => !value)}
        className={cn(
          "group/notice inline-flex min-h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          hasBody
            ? "cursor-pointer hover:bg-chat-surface-hover hover:text-foreground"
            : "cursor-default",
        )}
      >
        <span className="min-w-0 truncate">
          {label ? `${label} · ${summary}` : summary}
        </span>
        {hasBody && (
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3 w-3 shrink-0 opacity-45 transition-transform group-hover/notice:opacity-70",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {expanded && hasBody && (
        <div
          data-selection="text"
          className="ml-[7px] min-w-0 border-l border-border/60 py-1.5 pl-3 pr-1"
        >
          <CodeEvidence text={body} />
        </div>
      )}
    </div>
  );
}

export interface BubbleProps {
  m: UiMessage;
  /**
   * Renderer for the message's images — the shell's dispatch of the official
   * `conversation.message.images` seat. The default occupant renders compact
   * gallery tiles; a plugin taking the seat over replaces just the image
   * side. The second argument preserves the official compact hint for plugin
   * occupants. Amiba uses fixed-size cards in every attachment row. With
   * no renderer (loader-less hosts), durable images are omitted and files
   * keep their cards.
   */
  messageImages?: (images: NonNullable<UiMessage["images"]>, compact?: boolean) => ReactNode;
  /** Turn-level renderers use this after moving execution details into one summary. */
  suppressTrace?: boolean;
  /** MessageTurns renders terminal run state after the whole execution segment. */
  suppressRunBoundary?: boolean;
  /**
   * Called when the "Open in my browser →" chip on a finished assistant
   * bubble is clicked. Extension impl opens in a chrome tab; desktop impl
   * defers to `shell.openExternal`.
   */
  onOpenAgentDestination?: (url: string) => void | Promise<void>;
}

function hasInterleavedAssistantTimeline(message: UiMessage): boolean {
  const timeline = message.assistantTimeline ?? [];
  return (
    (timeline.length > 0 && !!message.streaming) ||
    timeline.some(item => item.kind === "reasoning" || item.kind === "compaction" || item.kind === "retry") ||
    timeline.some(
      (item) => item.kind === "text" && item.text.trim().length > 0,
    ) && timeline.some((item) => item.kind !== "text")
  );
}

/**
 * Renders one message row.
 *
 *  - **user**     — full-width rounded card with attachment + page chips
 *                   inside the card so the question and what it pulled in
 *                   read as one unit.
 *  - **assistant**— Streamdown markdown body with optional reasoning trace,
 *                   verbose tool-arg dump, tool progress chips, approval
 *                   audit trail, and "Open in my browser →" chip.
 *  - other roles  — minimal grey monospace box for visibility.
 */
function BubbleUnmemoized({
  m,
  messageImages,
  suppressTrace = false,
  suppressRunBoundary = false,
  onOpenAgentDestination,
}: BubbleProps) {
  const { t } = useT();
  const resolveMessageSourceLabel = useContext(MessageSourceLabelContext);
  const renderNotice = useContext(MessageNoticeRendererContext);
  const awaitingUserInput = useContext(AwaitingUserInputContext);

  if (m.role === "user") {
    // An ACCOUNT of something that happened (a steward task report, a guard's
    // reminder) rather than a turn somebody took. It rides a user-role
    // message because that is where the model reads it, but nobody said it
    // to anybody — so it gets the quiet collapsed row, not the user card.
    if (m.notice) {
      const producer = m.origin?.kind === "plugin" ? m.origin.plugin : "";
      const modelChange = producer === "model-selection" ? m.notice.summary.split(/\s*→\s*/) : [];
      const fallback = modelChange.length === 2 && modelChange.every(value => value.trim())
        ? <ModelChangeNotice from={modelChange[0]!.trim()} to={modelChange[1]!.trim()} />
        : (
        <MessageNoticeRow
          summary={m.notice.summary}
          label={
            producer ? (resolveMessageSourceLabel?.(producer) ?? producer) : ""
          }
          body={stripManagedResourceContext(bubbleTextContent(m.content))}
        />
      );
      return renderNotice ? renderNotice({ source: producer, summary: m.notice.summary, reference: m.notice.reference,
        body: stripManagedResourceContext(bubbleTextContent(m.content)) }, fallback) : fallback;
    }
    const bodyText = stripManagedResourceContext(bubbleTextContent(m.content));
    const fileBadges = m.attachmentBadges ?? [];
    // The attachment row mirrors the official user message: one container,
    // attachments in their ORIGINAL content order, files and images
    // interleaved as the message carried them. When the ordered list is
    // missing (optimistic live bubble, plugin messages) it is rebuilt from
    // badges — an IMAGE badge renders as the same thumbnail tile as a
    // durable image, not as a file chip.
    const imageBadges = fileBadges.filter((badge) => badge.kind === "image");
    const attachments: readonly MessageAttachment[] = m.attachments ?? [
      ...fileBadges
        .filter((badge) => badge.kind !== "image")
        .map((badge) => ({ kind: "file" as const, badge })),
      ...(m.images ?? []).map((image) => ({ kind: "image" as const, image })),
    ];
    const hasContent = bodyText.length > 0;
    // ONE attachment presentation everywhere: file cards natively, images as
    // a single seat invocation (the default `conversation.message.images`
    // occupant renders the same compact tiles the composer uses; a plugin
    // taking the seat over replaces just the image side, still inside the
    // shared row). Only DURABLE image refs go through the seat — an image
    // badge on an optimistic live bubble has no session-readable ref yet, so
    // it renders straight from its 256px thumbnail as the same tile shape.
    // Preserve the official compact hint for third-party seat occupants. Our
    // default occupant uses the same fixed card dimensions regardless of this hint.
    const durableImages: NonNullable<UiMessage["images"]> =
      m.images?.length
        ? m.images
        : attachments.flatMap((item) => (item.kind === "image" ? [item.image] : []));
    const hasRefs = attachments.length > 0 || imageBadges.length > 0 || durableImages.length > 0;
    // A durable message carries images as session-readable refs (`m.images`);
    // the same image also appears as an attachmentBadge, which is ONLY used
    // as the optimistic live fallback when no refs exist yet.
    const optimisticImageBadges =
      durableImages.length === 0 ? imageBadges : [];
    const compactRow = attachments.length + imageBadges.length > 1;
    const imageNode =
      messageImages && durableImages.length > 0 ? (
        <WorkbenchViewBoundary fallback={null}>
          <MessageImages images={durableImages} render={messageImages} compact={compactRow} />
        </WorkbenchViewBoundary>
      ) : undefined;
    let imageGroupPlaced = false;
    const galleryItems: AttachmentGalleryItem[] = [];
    // Optimistic badge-only images first — they have no durable ref, so they
    // render straight from their thumbnail before the durable image group.
    for (const badge of optimisticImageBadges) {
      galleryItems.push({
        kind: "image",
        id: badge.uiId,
        name: badge.name,
        size: badge.size,
        thumbUrl: badge.thumbDataUrl ?? null,
        previewUrl: badge.thumbDataUrl ?? null,
      });
    }
    for (const item of attachments) {
      if (item.kind === "file") {
        galleryItems.push({
          kind: "file",
          id: item.badge.uiId,
          name: item.badge.name,
          fileKind: item.badge.kind,
          size: item.badge.size,
        });
        continue;
      }
      if (!imageNode || imageGroupPlaced) continue;
      imageGroupPlaced = true;
      galleryItems.push({ kind: "image", id: "message-images", node: imageNode });
    }
    // A message a plugin dispatched on the user's behalf (a relayed task
    // brief, an inbound IM message) reads as a user turn but did not come
    // from the person at the composer — say so, in the same quiet chip the
    // session list uses for its own plugin badges.
    const sourcePlugin = m.origin?.kind === "plugin" ? m.origin.plugin : "";
    const producerLabel = sourcePlugin
      ? (resolveMessageSourceLabel?.(sourcePlugin) ?? t("sidepanel.message.otherApp"))
      : "";
    const senderName = m.origin?.senderName?.trim();
    const sourceLabel = producerLabel && senderName ? `${producerLabel} · ${senderName}` : producerLabel;
    return (
      <div
        data-selection="text"
        className="min-w-0 rounded-xl px-4 py-3 text-sm text-foreground"
      >
        {sourceLabel && (
          <div
            data-testid="message-source"
            className="mb-2 inline-flex rounded bg-chat-surface px-1 py-0.5 text-[10px] leading-none text-muted-foreground"
          >
            {t("sidepanel.message.from", { source: sourceLabel })}
          </div>
        )}
        {hasRefs && (
          galleryItems.length > 0 ? (
            <div
              data-message-attachments
              className={hasContent ? "mb-2" : undefined}
            >
              <AttachmentGallery items={galleryItems} />
            </div>
          ) : (
            <div
              data-message-attachments
              className={cn(
                "flex flex-wrap items-center gap-1.5",
                hasContent && "mb-2",
              )}
            >
              {attachments.map((item, index) =>
                item.kind === "file" ? (
                  <AttachmentBadgeView key={item.badge.uiId} badge={item.badge} />
                ) : messageImages ? (
                  <WorkbenchViewBoundary
                    key={`image:${item.image.attachment.attachmentId}`}
                    fallback={null}
                  >
                    <MessageImages images={[item.image]} render={messageImages} />
                  </WorkbenchViewBoundary>
                ) : (
                  <Fragment key={`image:${index}`} />
                ),
              )}
            </div>
          )
        )}
        {hasContent && (
          <div className="whitespace-pre-wrap break-words"><ReferenceText text={bodyText} /></div>
        )}
      </div>
    );
  }

  if (m.role === "assistant") {
    const trace = resolveAssistantTrace(m);
    if (!suppressTrace && hasInterleavedAssistantTimeline(m)) {
      return (
        <InterleavedAssistantFlow
          message={m}
          suppressRunBoundary={suppressRunBoundary}
          onOpenAgentDestination={onOpenAgentDestination}
        />
      );
    }
    const hasBody = trace.bodyText.trim().length > 0;
    const traceVisible = trace.hasTrace && !suppressTrace;
    const runBoundary = suppressRunBoundary ? null : trace.runBoundary;
    const hasFinalDestination =
      !m.streaming && Boolean(m.agentFinalUrl && onOpenAgentDestination);

    const hasReasoningFold = trace.reasoningText.length > 0;

    // A completed assistant message with no answer or inspectable execution
    // record should take up no space in the conversation.
    if (
      !m.streaming &&
      !hasBody &&
      !traceVisible &&
      !runBoundary &&
      !hasFinalDestination &&
      !hasReasoningFold
    ) {
      return null;
    }

    // MessageTurns renders this trace once for the whole user turn. Suppress
    // the otherwise-duplicated streaming placeholder while that aggregate is
    // already visible.
    if (
      suppressTrace &&
      trace.hasTrace &&
      !hasBody &&
      !runBoundary &&
      !hasFinalDestination
    ) {
      return null;
    }

    // Before the first reasoning/tool/text event, keep the placeholder to a
    // single quiet line. As soon as real execution state arrives, render it.
    const hasVisibleContent =
      hasBody || traceVisible || hasFinalDestination || hasReasoningFold;
    const isEmptyStreaming = !!m.streaming && !hasVisibleContent;
    if (isEmptyStreaming) {
      if (awaitingUserInput) return null;
      return (
        <div data-background-surface="assistant-message" className="px-4 py-3 text-sm" aria-live="polite">
          <div className="inline-flex max-w-full items-center text-muted-foreground">
            <span className="agent-thinking-text truncate">
              {t("sidepanel.trace.working")}
            </span>
          </div>
        </div>
      );
    }

    // Body text that is still streaming ends in Streamdown's caret, but
    // once the prose settles and the model moves on to its next call there
    // is nothing animated left on screen — say the turn is still running.
    const showRunning = !!m.streaming && hasBody && !awaitingUserInput;

    return (
      <div data-background-surface="assistant-message" data-selection="text" className="min-w-0 px-4 py-3 text-sm">
        {(hasReasoningFold || traceVisible) && (
          /* One aggregated process row: thought + tools + approvals fold
             behind a single natural summary, on every render path. */
          <div className={cn(hasBody ? "mb-2" : "")}>
            <ExecutionDisclosure
              details={[
                ...(hasReasoningFold
                  ? [
                      {
                        kind: "reasoning" as const,
                        id: `${m.uiId}:reasoning`,
                        text: trace.reasoningText,
                        reasoningMs: m.reasoningMs,
                      },
                    ]
                  : []),
                ...(traceVisible && trace.fallbackToolDetails.length > 0
                  ? [
                      {
                        kind: "fallback" as const,
                        id: `${m.uiId}:fallback`,
                        text: trace.fallbackToolDetails,
                        streaming: !!m.streaming,
                      },
                    ]
                  : []),
                ...(traceVisible ? trace.items : []),
              ]}
              tools={traceVisible ? trace.toolProgress : []}
              streaming={!!m.streaming && !hasBody && !awaitingUserInput}
              processMs={m.processMs}
            />
          </div>
        )}
        {hasBody && (
          <WorkspaceMarkdown
            sources={sliceTextSources(thinkingBodySource(joinTextSources(messageTextTimeline(m).filter(item=>item.kind==="text").map(timelineTextSource),"")),trace.bodyText)}
            components={chatMarkdownComponents}
            mode={m.streaming ? "streaming" : "static"}
            parseIncompleteMarkdown
            caret="circle"
            isAnimating={!!m.streaming}
            className="chat-md break-words"
          >
            {trace.bodyText}
          </WorkspaceMarkdown>
        )}
        {showRunning && <TurnRunningIndicator />}
        {!m.streaming && m.agentFinalUrl && onOpenAgentDestination && (
          <AgentDestinationChip
            url={m.agentFinalUrl}
            title={m.agentFinalTitle}
            onOpen={onOpenAgentDestination}
          />
        )}
        {runBoundary && (
          <RunBoundary
            state={runBoundary}
            followsContent={hasBody || hasFinalDestination}
          />
        )}
      </div>
    );
  }

  return (
    <div
      data-selection="text"
      className="mx-3 rounded-md bg-chat-surface p-2 font-mono text-xs"
    >
      [{m.role}] {bubbleTextContent(m.content)}
    </div>
  );
}

type RunBoundaryState = "interrupted" | "stopped";

const RUN_BOUNDARY_SUFFIX =
  /(?:^|(?:\r?\n)+)\[(interrupted|stopped|stop)\][\t \r\n]*$/i;

function splitRunBoundaryFromBody(text: string): {
  body: string;
  state: RunBoundaryState | null;
} {
  const match = RUN_BOUNDARY_SUFFIX.exec(text);
  if (!match) return { body: text, state: null };
  return {
    body: text.slice(0, match.index).trimEnd(),
    state:
      match[1]?.toLowerCase() === "interrupted" ? "interrupted" : "stopped",
  };
}

function RunBoundary({
  state,
  followsContent = false,
}: {
  state: RunBoundaryState;
  followsContent?: boolean;
}) {
  const { t } = useT();
  const interrupted = state === "interrupted";

  return (
    <div
      data-run-boundary={state}
      className={cn(
        "flex min-w-0 items-center px-1",
        followsContent ? "mt-2" : "py-1",
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-normal leading-4 text-muted-foreground/70">
        <span
          aria-hidden
          data-run-boundary-icon={interrupted ? "pause-solid" : "stop-solid"}
          className={cn(
            "inline-flex h-4 w-3 shrink-0 items-center justify-center",
            interrupted
              ? "text-amber-600/75 dark:text-amber-300/70"
              : "text-muted-foreground/55",
          )}
        >
          {interrupted ? (
            <span className="inline-flex h-2 w-2 items-center justify-center gap-[2px]">
              <span
                data-pause-bar
                className="h-2 w-[2px] rounded-[0.5px] bg-current"
              />
              <span
                data-pause-bar
                className="h-2 w-[2px] rounded-[0.5px] bg-current"
              />
            </span>
          ) : (
            <span className="h-2 w-2 rounded-[1.5px] bg-current" />
          )}
        </span>
        <span className="truncate leading-4 tracking-[0.01em]">
          {t(
            interrupted
              ? "sidepanel.runBoundary.interrupted"
              : "sidepanel.runBoundary.stopped",
          )}
        </span>
      </span>
    </div>
  );
}

type ResolvedTraceItem =
  | { kind: "tool"; id: string; event: ToolProgress }
  | { kind: "approval"; id: string; record: ApprovalRecord };

function resolveAssistantTrace(m: UiMessage) {
  const terminal = splitRunBoundaryFromBody(bubbleTextContent(m.content));
  const { body: bodyText, thinking: extractedThinking } = splitThinkingFromBody(
    terminal.body,
  );
  const verboseText = bubbleTextContent(m.streamVerbose);
  const reasoningText = [
    bubbleTextContent(m.reasoning).trim(),
    extractedThinking,
  ]
    .filter((text) => text.length > 0)
    .join("\n\n");
  const toolProgress = m.toolProgress ?? [];
  const approvalRecords = m.approvalRecords ?? [];
  const progressMap = new Map(
    toolProgress.map((event) => [event.toolCallId, event] as const),
  );
  const approvalMap = new Map(
    approvalRecords.map((record) => [record.approvalId, record] as const),
  );
  const items: ResolvedTraceItem[] = [];
  const timelineToolIds = new Set<string>();
  const timelineApprovalIds = new Set<string>();

  for (const item of m.assistantTimeline ?? []) {
    if (item.kind === "tool") {
      const event = progressMap.get(item.toolCallId);
      if (!event) continue;
      timelineToolIds.add(item.toolCallId);
      items.push({ kind: "tool", id: item.id, event });
      continue;
    }
    if (item.kind === "approval") {
      const record = approvalMap.get(item.approvalId);
      if (!record) continue;
      timelineApprovalIds.add(item.approvalId);
      items.push({ kind: "approval", id: item.id, record });
    }
  }

  for (const event of toolProgress) {
    if (timelineToolIds.has(event.toolCallId)) continue;
    items.push({ kind: "tool", id: `tool:${event.toolCallId}`, event });
  }
  for (const record of approvalRecords) {
    if (timelineApprovalIds.has(record.approvalId)) continue;
    items.push({
      kind: "approval",
      id: `approval:${record.approvalId}`,
      record,
    });
  }

  const hasPerToolDetails = toolProgress.some(hasToolDetail);
  const fallbackToolDetails =
    verboseText.trim().length > 0 && !hasPerToolDetails
      ? verboseText.trim()
      : "";

  return {
    bodyText,
    runBoundary: terminal.state,
    reasoningText,
    fallbackToolDetails,
    toolProgress,
    items,
    hasRunningTool: toolProgress.some((event) => event.status === "running"),
    // Reasoning deliberately does NOT count: the thought fold is owned by
    // the bubble itself (rendered above the body) and must never flip a
    // body-carrying message into the trace-suppression/aggregation economy.
    hasTrace: fallbackToolDetails.length > 0 || items.length > 0,
  };
}

function compactProgressNote(text: string): string {
  const parts = text
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const latest = parts.at(-1) ?? "";
  return latest.length > 160 ? `${latest.slice(0, 159)}…` : latest;
}

function thoughtLabel(
  t: ReturnType<typeof useT>["t"],
  reasoningMs?: number,
): string {
  if (reasoningMs === undefined || reasoningMs <= 0) {
    return t("sidepanel.trace.thoughtProcess");
  }
  const seconds = Math.max(1, Math.round(reasoningMs / 1000));
  if (seconds < 60) {
    return t("sidepanel.trace.thoughtForSeconds", { seconds });
  }
  return t("sidepanel.trace.thoughtForMinutes", {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  });
}

/** Natural total-effort label for a completed process aggregate. */
function workedLabel(
  t: ReturnType<typeof useT>["t"],
  processMs: number,
): string {
  const seconds = Math.max(1, Math.round(processMs / 1000));
  if (seconds < 60) {
    return t("sidepanel.trace.workedForSeconds", { seconds });
  }
  return t("sidepanel.trace.workedForMinutes", {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  });
}

function TraceDisclosure({
  label,
  labelClassName,
  text,
  streaming,
}: {
  label: string;
  labelClassName?: string;
  text: string;
  streaming: boolean;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        title={
          expanded
            ? t("sidepanel.trace.collapseDetails")
            : t("sidepanel.trace.expandDetails")
        }
        onClick={() => setExpanded((value) => !value)}
        className="group/trace inline-flex min-h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-chat-surface-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span className={cn("min-w-0 truncate", labelClassName)}>{label}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3 w-3 shrink-0 opacity-45 transition-transform group-hover/trace:opacity-70",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded && (
        <div className="ml-[7px] border-l border-border/60 py-1.5 pl-4 pr-1">
          <Streamdown
            components={chatMarkdownComponents}
            mode={streaming ? "streaming" : "static"}
            parseIncompleteMarkdown
            caret="circle"
            isAnimating={streaming}
            className="chat-md chat-md--reasoning break-words text-xs text-muted-foreground/85"
          >
            {text}
          </Streamdown>
        </div>
      )}
    </div>
  );
}

const ExecutionNoticesContext = createContext<ReadonlyMap<string, UiMessage[]>>(new Map());

type TurnTraceDetail =
  | { kind: "notice"; id: string; message: UiMessage }
  | {
      kind: "fallback";
      id: string;
      text: string;
      streaming: boolean;
    }
  | {
      kind: "reasoning";
      id: string;
      text: string;
      reasoningMs?: number;
      /** When the segment is still streaming, its live row ticks from this. */
      startedAt?: number;
    }
  | {
      /** Intermediate step narration, folded with the tools it accompanied. */
      kind: "narration";
      id: string;
      text: string;
      sources?: TextSourceRange[];
    }
  | {
      kind: "tool";
      id: string;
      event: ToolProgress;
    }
  | {
      kind: "approval";
      id: string;
      record: ApprovalRecord;
    };

/**
 * One compact disclosure for a consecutive execution segment.
 */
/**
 * The full thinking text, live, while the model is still reasoning.
 *
 * The collapsed summary used to show only `compactProgressNote` — the LAST
 * newline-separated fragment of the reasoning, replaced whenever a new one
 * began. The accumulated text existed all along (every layer appends); only
 * the presentation dropped it. This pane shows the whole accumulating trace
 * in a bounded scroll area, pinned to the newest line unless the reader has
 * scrolled back up to study something.
 */
function LiveReasoningPane({ text }: { text: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [text]);

  return (
    <div
      ref={scrollRef}
      data-live-reasoning
      onScroll={() => {
        const node = scrollRef.current;
        if (!node) return;
        pinnedRef.current =
          node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      }}
      className="ml-[7px] max-h-40 overflow-y-auto border-l border-border/60 py-1 pl-3 pr-1"
    >
      <Streamdown
        components={chatMarkdownComponents}
        mode="static"
        parseIncompleteMarkdown
        className="chat-md chat-md--reasoning break-words px-1.5 text-xs text-muted-foreground/85"
      >
        {text}
      </Streamdown>
    </div>
  );
}

/**
 * A streaming thinking segment rendered as its own ROW in the execution
 * series — same shape as a settled reasoning row (brain icon, target, live
 * duration), with the accumulating text open underneath while it streams.
 *
 * The thought used to be a bare text block BELOW the fold, visually detached
 * from the executed rows that precede it. Keeping it in the series makes the
 * "正在思考" state part of the fold itself: the row carries the icon the tool
 * rows have, its duration ticks while the model reasons, and the full text
 * stays visible under the row without floating outside the disclosure.
 */
function LiveReasoningRow({
  text,
  startedAt,
  reasoningMs,
  streaming,
}: {
  text: string;
  startedAt?: number;
  reasoningMs?: number;
  streaming: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(true);
  // Force a re-render every second while streaming so the duration ticks
  // live, exactly like a running tool row. Once the segment settles the
  // interval tears down and `reasoningMs` takes over.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!streaming || startedAt === undefined) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [streaming, startedAt]);
  void tick;
  const durationMs =
    streaming && startedAt !== undefined
      ? Math.max(0, Date.now() - startedAt)
      : reasoningMs;

  return (
    <div data-live-reasoning-row>
      <ToolRowFrame
        icon={Brain}
        action=""
        ariaLabel={t("sidepanel.trace.thinking")}
        target={
          <span className="min-w-0 max-w-80 truncate agent-thinking-text">
            {compactProgressNote(text) || t("sidepanel.trace.thinking")}
          </span>
        }
        {...(durationMs === undefined ? {} : { durationMs })}
        running={streaming}
        detail={<LiveReasoningPane text={text} />}
        expanded={open}
        onExpandedChange={setOpen}
        expandTitle={t("sidepanel.trace.expandDetails")}
        collapseTitle={t("sidepanel.trace.collapseDetails")}
      />
    </div>
  );
}

const noNavigationSubscribe = () => () => {};
const idleNavigation = {callId:"",version:0};
const noNavigationRequest = () => idleNavigation;
function ExecutionDisclosure({
  details,
  tools,
  streaming,
  latestProgress = "",
  processMs,
  defaultExpanded = false,
}: {
  details: TurnTraceDetail[];
  tools: ToolProgress[];
  streaming: boolean;
  /** Live progress availability (thinking without a timeline row yet). */
  latestProgress?: string;
  processMs?: number;
  /** Open on mount — used by streamed execution so merged narration rows
   * stay visible live, matching the settled series after completion. */
  defaultExpanded?: boolean;
}) {
  const { t } = useT();
  // While the model is thinking, the live thought owns the turn the same way
  // a running tool does: the disclosure opens so the reasoning row + text are
  // part of the fold, instead of floating as a detached block below it.
  const reasoningOwnsActivity =
    details.at(-1)?.kind === "reasoning" ||
    (tools.length === 0 && latestProgress.length > 0);
  const [expanded, setExpanded] = useState(
    defaultExpanded || (streaming && reasoningOwnsActivity),
  );

  const navigation = useToolCallSeat()?.navigation;
  const navigationRequest = useSyncExternalStore(navigation?.subscribe ?? noNavigationSubscribe, navigation?.getSnapshot ?? noNavigationRequest);
  const handledNavigation = useRef(0);
  useEffect(()=>{if(navigationRequest.version !== handledNavigation.current && tools.some(tool=>{const block=toolCallBlockFromProgress(tool);return tool.toolCallId === navigationRequest.callId || (block && toolCallTreeContains(block,navigationRequest.callId));})){handledNavigation.current=navigationRequest.version;setExpanded(true);}},[navigationRequest, tools]);

  if (details.length === 0 && !latestProgress) return null;

  const runningTool = [...tools]
    .reverse()
    .find((event) => event.status === "running");
  const hasDetails = details.length > 0;
  const reasoningDetails = details.filter(
    (detail): detail is Extract<TurnTraceDetail, { kind: "reasoning" }> =>
      detail.kind === "reasoning",
  );
  const thought = reasoningDetails[0];
  // Every thinking segment of the turn contributes to the aggregate label, so
  // a multi-segment trace never reports only its first fragment's span.
  const thoughtMs = reasoningDetails.reduce<number | undefined>(
    (total, detail) =>
      detail.reasoningMs === undefined
        ? total
        : (total ?? 0) + Math.max(0, detail.reasoningMs),
    undefined,
  );
  // One natural phrase, not a data pile: total effort when tools ran,
  // thought duration when the turn was reasoning-only.
  const completedLabel =
    tools.length > 0 && typeof processMs === "number" && processMs > 0
      ? workedLabel(t, processMs)
      : thought
        ? thoughtLabel(t, thoughtMs)
        : tools.length > 0
          ? t("sidepanel.trace.toolCount", { count: tools.length })
          : t("sidepanel.trace.executionDetails");
  // Keep the latest completed action visible, with its own completed tense.
  // Only a genuinely live activity may suppress the separate turn fallback.
  const summaryTool = streaming && runningTool
    ? runningTool
    : streaming && !reasoningOwnsActivity
      ? tools.at(-1)
      : undefined;
  const showWaiting = streaming && Boolean(summaryTool) && !runningTool;
  const summaryActive = streaming && !showWaiting;
  // The unified in-progress label: the live thought owns the summary while
  // thinking; between calls it reads as the last completed action plus the
  // pulsing "正在思考…" — one fold line, not a detached tail below the fold.
  const summaryLabel = summaryTool
    ? <ToolChip event={summaryTool} mode="summary" />
    : streaming
      ? reasoningOwnsActivity
        ? t("sidepanel.trace.thinking")
        : t("sidepanel.trace.working")
      : completedLabel;

  return (
    <div className="min-w-0 text-sm" data-execution-summary>
      <button
        type="button"
        disabled={!hasDetails}
        aria-expanded={hasDetails ? expanded : undefined}
        title={hasDetails ? (expanded ? t("sidepanel.trace.collapseDetails") : t("sidepanel.trace.expandDetails")) : undefined}
        onClick={() => hasDetails && setExpanded((value) => !value)}
        className={cn(
          "group/run inline-flex min-h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          hasDetails
            ? "cursor-pointer hover:bg-chat-surface-hover hover:text-foreground"
            : "cursor-default",
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate",
            summaryActive && "agent-thinking-text",

          )}
        >
          {summaryLabel}
        </span>
        {showWaiting && (
          <span aria-hidden className="shrink-0 truncate agent-thinking-text">
            {" · "}
            {t("sidepanel.trace.thinking")}
          </span>
        )}
        {hasDetails && (
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3 w-3 shrink-0 opacity-45 transition-transform group-hover/run:opacity-70",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {expanded && hasDetails && (
        <div className="ml-[7px] flex min-w-0 flex-col gap-0.5 border-l border-border/60 py-1.5 pl-3 pr-1">
          {details.map((detail, index) => {
            if (detail.kind === "notice") return <div key={detail.id} className="min-w-0 self-stretch text-left [&>*]:justify-start"><Bubble m={detail.message} /></div>;
            if (detail.kind === "fallback") {
              return (
                <TraceDisclosure
                  key={detail.id}
                  label={t("sidepanel.trace.toolDetails")}
                  text={detail.text}
                  streaming={detail.streaming}
                />
              );
            }
            if (detail.kind === "reasoning") {
              // The newest thinking segment streams as its OWN row — icon,
              // ticking duration, live text open underneath — so the thought
              // reads as part of the executed series instead of a bare text
              // block below the fold. Earlier segments keep their own row.
              if (streaming && index === details.length - 1) {
                return (
                  <LiveReasoningRow
                    key={detail.id}
                    text={detail.text}
                    startedAt={detail.startedAt}
                    reasoningMs={detail.reasoningMs}
                    streaming={streaming}
                  />
                );
              }
              // A reasoning-only turn degenerates under uniform nesting: the
              // outer summary already reads "thought for Xs", so an inner
              // fold with the SAME label demands a second click to reach the
              // only content there is. When the thought is all the detail,
              // lay its text flat; the inner fold earns its place only when
              // it separates the thought from tool evidence around it.
              if (details.length === 1) {
                return (
                  <Streamdown
                    components={chatMarkdownComponents}
                    key={detail.id}
                    mode="static"
                    parseIncompleteMarkdown
                    className="chat-md chat-md--reasoning max-h-80 overflow-y-auto overscroll-contain break-words px-1.5 py-1 text-xs text-muted-foreground/85"
                  >
                    {detail.text}
                  </Streamdown>
                );
              }
              return <ToolRowFrame
                key={detail.id}
                icon={Brain}
                action=""
                ariaLabel={t("sidepanel.trace.thoughtProcess")}
                target={<span className="min-w-0 max-w-80 truncate text-foreground/65">{detail.text.replace(/\s+/g," ").trim()}</span>}
                durationMs={detail.reasoningMs}
                detail={<Streamdown components={chatMarkdownComponents} mode="static" parseIncompleteMarkdown className="chat-md chat-md--reasoning max-h-80 overflow-y-auto overscroll-contain break-words py-1 text-xs text-muted-foreground/85">{detail.text}</Streamdown>}
              />;
            }
            if (detail.kind === "narration") {
              return (
                <WorkspaceMarkdown
                  sources={detail.sources}
                  components={chatMarkdownComponents}
                  key={detail.id}
                  mode="static"
                  parseIncompleteMarkdown
                  className="chat-md chat-md--reasoning break-words px-1.5 text-xs text-muted-foreground/85"
                >
                  {detail.text}
                </WorkspaceMarkdown>
              );
            }
            if (detail.kind === "tool") {
              return <ToolChip key={detail.id} event={detail.event} />;
            }
            return (
              <ApprovalRecordChip key={detail.id} record={detail.record} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Collapses adjacent execution-only messages that lack per-tool details. */
function TurnExecutionDisclosureUnmemoized({ messages }: { messages: UiMessage[] }) {
  const awaitingUserInput = useContext(AwaitingUserInputContext);
  const notices = useContext(ExecutionNoticesContext);
  const details: TurnTraceDetail[] = [];
  const tools: ToolProgress[] = [];
  const seenToolIds = new Set<string>();
  const seenApprovalIds = new Set<string>();
  let latestProgress = "";

  for (const message of messages) {
    for (const notice of notices.get(message.uiId) ?? []) details.push({ kind: "notice", id: notice.uiId, message: notice });
    const trace = resolveAssistantTrace(message);
    if (message.streaming && trace.reasoningText) {
      latestProgress = compactProgressNote(trace.reasoningText);
    } else if (trace.reasoningText && !trace.bodyText) {
      // Body-carrying messages render their own inline thought fold via
      // the Bubble trace; the aggregate only owns execution-only bubbles.
      details.push({
        kind: "reasoning",
        id: `${message.uiId}:reasoning`,
        text: trace.reasoningText,
        reasoningMs: message.reasoningMs,
      });
    }
    if (trace.fallbackToolDetails) {
      details.push({
        kind: "fallback",
        id: `${message.uiId}:fallback`,
        text: trace.fallbackToolDetails,
        streaming: !!message.streaming,
      });
    }
    for (const item of trace.items) {
      if (item.kind === "tool") {
        if (seenToolIds.has(item.event.toolCallId)) continue;
        seenToolIds.add(item.event.toolCallId);
        tools.push(item.event);
        details.push(item);
        continue;
      }
      if (seenApprovalIds.has(item.record.approvalId)) continue;
      seenApprovalIds.add(item.record.approvalId);
      details.push(item);
    }
  }

  return (
    /* Rendered as a sibling of bubbles (not inside one), so it re-adds the
       bubble root's horizontal inset to stay aligned with them. */
    <div className="px-1 py-0.5">
      <ExecutionDisclosure
        details={details}
        tools={tools}
        streaming={!awaitingUserInput && messages.some((message) => message.streaming)}
        latestProgress={latestProgress}
        processMs={messages.reduce(
          (total, message) => total + (message.processMs ?? 0),
          0,
        )}
      />
    </div>
  );
}

/**
 * Memoized with a reference-level messages check: the `messages` array passed
 * in is rebuilt on every render, but its elements keep their identity for
 * completed turns, so unchanged execution disclosures skip re-rendering
 * (including their per-message `resolveAssistantTrace` work) during a live
 * stream flush.
 */
const TurnExecutionDisclosure = memo(
  TurnExecutionDisclosureUnmemoized,
  (prev, next) =>
    prev.messages.length === next.messages.length &&
    prev.messages.every((message, index) => message === next.messages[index]),
);

type TurnReplyItem =
  | {
      kind: "message";
      id: string;
      message: UiMessage;
      suppressTrace: boolean;
      suppressRunBoundary: boolean;
    }
  | {
      kind: "execution";
      id: string;
      messages: UiMessage[];
    }
  | {
      kind: "boundary";
      id: string;
      state: RunBoundaryState;
    };

/**
 * Rows created before the unified timeline do not contain `assistantTimeline`.
 * row order instead of lifting every tool call to the start of the user turn:
 *
 *   assistant text → every following tool → next assistant text
 *
 * A runtime may persist the first tool on the same assistant row as prose,
 * then persist later tools on empty assistant rows. Those storage boundaries
 * are not visible conversation boundaries, so all tools remain one compact
 * disclosure until the next visible message.
 */
function buildTurnReplyItems(replies: UiMessage[]): TurnReplyItem[] {
  const items: TurnReplyItem[] = [];
  let pendingExecution: UiMessage[] = [];

  const flushExecution = () => {
    if (pendingExecution.length === 0) return;
    items.push({
      kind: "execution",
      id: `execution:${pendingExecution[0]!.uiId}`,
      messages: pendingExecution,
    });
    pendingExecution = [];
  };

  const appendBoundary = (
    message: UiMessage,
    state: RunBoundaryState | null,
  ) => {
    if (!state) return;
    flushExecution();
    items.push({
      kind: "boundary",
      id: `boundary:${message.uiId}`,
      state,
    });
  };

  for (const message of replies) {
    if (
      message.role !== "assistant" ||
      hasInterleavedAssistantTimeline(message)
    ) {
      flushExecution();
      items.push({
        kind: "message",
        id: message.uiId,
        message,
        suppressTrace: false,
        suppressRunBoundary: false,
      });
      continue;
    }

    const trace = resolveAssistantTrace(message);
    const hasBody = trace.bodyText.trim().length > 0;
    const hasStandaloneVisual =
      hasBody ||
      Boolean(message.agentFinalUrl) ||
      Boolean(message.streaming) ||
      trace.reasoningText.length > 0;

    if (hasBody) {
      flushExecution();
      items.push({
        kind: "message",
        id: message.uiId,
        message,
        suppressTrace: trace.hasTrace,
        suppressRunBoundary: Boolean(trace.runBoundary),
      });
      if (trace.hasTrace) pendingExecution.push(message);
      appendBoundary(message, trace.runBoundary);
      continue;
    }

    if (trace.hasTrace) {
      pendingExecution.push(message);
      appendBoundary(message, trace.runBoundary);
      continue;
    }

    if (trace.runBoundary) {
      if (message.agentFinalUrl) {
        flushExecution();
        items.push({
          kind: "message",
          id: message.uiId,
          message,
          suppressTrace: false,
          suppressRunBoundary: true,
        });
      }
      appendBoundary(message, trace.runBoundary);
      continue;
    }

    // Completed empty assistant rows are persistence artifacts. They should
    // neither render nor split two otherwise-consecutive execution records.
    if (!hasStandaloneVisual) continue;

    flushExecution();
    items.push({
      kind: "message",
      id: message.uiId,
      message,
      suppressTrace: false,
      suppressRunBoundary: false,
    });
  }

  flushExecution();
  return items;
}

type AssistantFlowItem =
  | Extract<AssistantTimelineItem, {kind:"retry"}>
  | { kind: "compaction"; id: string; compaction: CompactionProgress }
  | { kind: "text"; id: string; text: string; sources: TextSourceRange[] }
  | {
      kind: "execution";
      id: string;
      details: TurnTraceDetail[];
      tools: ToolProgress[];
      /** Wall-clock span of this segment's own activity, when its reasoning
       * and tool timestamps allow measuring one. */
      processMs?: number;
    };

function buildAssistantFlow(message: UiMessage): AssistantFlowItem[] {
  const timeline = message.assistantTimeline ?? [];
  const tools = new Map(
    (message.toolProgress ?? []).map((event) => [event.toolCallId, event]),
  );
  const approvals = new Map(
    (message.approvalRecords ?? []).map((record) => [
      record.approvalId,
      record,
    ]),
  );
  const seenTools = new Set<string>();
  const seenApprovals = new Set<string>();
  const flow: AssistantFlowItem[] = [];
  let pendingDetails: TurnTraceDetail[] = [];
  let pendingTools: ToolProgress[] = [];
  let pendingStart: number | undefined;
  let pendingEnd: number | undefined;

  // One span per execution segment, measured from the timestamps the
  // segment's own items carry. The segment summary reads "worked for X"
  // from this instead of borrowing a single reasoning fragment's span.
  const noteSpan = (from?: number, to?: number) => {
    if (typeof from === "number") {
      pendingStart = pendingStart === undefined ? from : Math.min(pendingStart, from);
    }
    if (typeof to === "number") {
      pendingEnd = pendingEnd === undefined ? to : Math.max(pendingEnd, to);
    }
  };

  // Every timeline item joins the series in ITS OWN chronological row: the
  // think → tool → think turn collapses into ONE aggregate row that expands
  // back to exactly those three rows. Reasoning is never concatenated into a
  // single thought blob, so a later thinking segment can never be pasted
  // inside the earlier one. A text item is MID-TURN narration (folds into the
  // series beside its tools) when a tool call both precedes and follows it;
  // leading intro prose and the trailing result stay standalone paragraphs.
  // The model emits working narration with two different wire types
  // (reasoning vs text), so placement is decided by position rather than
  // type — otherwise near-identical lines would inconsistently render as
  // timed rows or detached paragraphs.
  const midTurnTextIds = new Set<string>();
  {
    const textIndexes = timeline
      .map((item, index) => (item.kind === "text" ? index : -1))
      .filter((index) => index >= 0);
    const toolIndexes = timeline
      .map((item, index) => (item.kind === "tool" ? index : -1))
      .filter((index) => index >= 0);
    for (const index of textIndexes) {
      const preceded = toolIndexes.some((toolIndex) => toolIndex < index);
      const followed = toolIndexes.some((toolIndex) => toolIndex > index);
      if (preceded && followed) midTurnTextIds.add(timeline[index]!.id);
    }
  }

  const flushExecution = () => {
    if (pendingDetails.length === 0) return;
    flow.push({
      kind: "execution",
      id: pendingDetails[0]!.id,
      details: pendingDetails,
      tools: pendingTools,
      processMs:
        pendingStart !== undefined &&
        pendingEnd !== undefined &&
        pendingEnd > pendingStart
          ? pendingEnd - pendingStart
          : undefined,
    });
    pendingDetails = [];
    pendingTools = [];
    pendingStart = undefined;
    pendingEnd = undefined;
  };
  const appendText = (id: string, text: string, sources: TextSourceRange[] = []) => {
    const body = splitThinkingFromBody(text).body;
    if (!body.trim()) return;
    const resolved = sliceTextSources(thinkingBodySource({text,sources}),body);
    if (midTurnTextIds.has(id) && pendingDetails.length > 0) {
      // Middle-of-execution narration stays inside the series with the
      // tools it accompanied instead of being pulled out into its own
      // paragraph.
      pendingDetails.push({
        kind: "narration",
        id,
        text: body,
        sources: resolved,
      });
      return;
    }
    flushExecution();
    flow.push({ kind: "text", id, text: body, sources: resolved });
  };
  const appendTool = (id: string, toolCallId: string) => {
    if (seenTools.has(toolCallId)) return;
    const event = tools.get(toolCallId);
    if (!event) return;
    seenTools.add(toolCallId);
    noteSpan(
      event.startedAt,
      event.startedAt !== undefined && typeof event.durationMs === "number"
        ? event.startedAt + event.durationMs
        : undefined,
    );
    pendingTools.push(event);
    pendingDetails.push({ kind: "tool", id, event });
  };
  const appendApproval = (id: string, approvalId: string) => {
    if (seenApprovals.has(approvalId)) return;
    const record = approvals.get(approvalId);
    if (!record) return;
    seenApprovals.add(approvalId);
    pendingDetails.push({ kind: "approval", id, record });
  };

  for (const item of timeline) {
    if (item.kind === "text") {
      appendText(item.id, item.text, timelineTextSource(item).sources);
    } else if (item.kind === "reasoning") {
      // Its own row, in place: a later segment must never be appended to an
      // earlier one's text just because both are reasoning.
      noteSpan(item.startedAt, item.endedAt);
      pendingDetails.push({
        kind: "reasoning",
        id: item.id,
        text: item.text,
        reasoningMs:
          item.startedAt !== undefined && item.endedAt !== undefined
            ? Math.max(0, item.endedAt - item.startedAt)
            : undefined,
        startedAt: item.startedAt,
      });
    } else if (item.kind === "tool") {
      appendTool(item.id, item.toolCallId);
    } else if (item.kind === "compaction" || item.kind === "retry") {
      flushExecution();
      flow.push(item);
    } else {
      appendApproval(item.id, item.approvalId);
    }
  }

  const timelineText = timeline
    .filter((item) => item.kind === "text")
    .map((item) => item.text)
    .join("");
  const rawBody = splitRunBoundaryFromBody(
    bubbleTextContent(message.content),
  ).body;
  if (
    rawBody.startsWith(timelineText) &&
    rawBody.length > timelineText.length
  ) {
    const tail = rawBody.slice(timelineText.length);
    appendText(`${message.uiId}:text-tail`, tail, message.assistantDraftSource ? sliceTextSources(timelineTextSource(message.assistantDraftSource), tail) : []);
  }

  for (const event of message.toolProgress ?? []) {
    appendTool(`tool:${event.toolCallId}`, event.toolCallId);
  }
  for (const record of message.approvalRecords ?? []) {
    appendApproval(`approval:${record.approvalId}`, record.approvalId);
  }

  const trace = resolveAssistantTrace(message);
  if (trace.fallbackToolDetails) {
    pendingDetails.push({
      kind: "fallback",
      id: `${message.uiId}:fallback`,
      text: trace.fallbackToolDetails,
      streaming: !!message.streaming,
    });
  }
  flushExecution();
  return flow;
}

function InterleavedAssistantFlow({
  message,
  suppressRunBoundary = false,
  onOpenAgentDestination,
}: {
  message: UiMessage;
  suppressRunBoundary?: boolean;
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"];
}) {
  const { t } = useT();
  const executionNotices = useContext(ExecutionNoticesContext);
  const awaitingUserInput = useContext(AwaitingUserInputContext);
  const flow = buildAssistantFlow(message);
  const trace = resolveAssistantTrace(message);
  const runBoundary = suppressRunBoundary ? null : trace.runBoundary;
  const hasFinalDestination =
    !message.streaming &&
    Boolean(message.agentFinalUrl && onOpenAgentDestination);
  // Only a settled turn has a result. During execution, render the stable
  // timeline below without reclassifying text when another tool arrives.
  const { head: processSegments, tail: resultSegments } =
    splitTrailingTextRun(flow);
  const processDetails: TurnTraceDetail[] = processSegments.flatMap(
    (segment) =>
      segment.kind === "execution"
        ? segment.details
        : segment.kind === "text" ? [{ kind: "narration" as const, id: segment.id, text: segment.text, sources: segment.sources }] : [],
  );
  processDetails.push(
    ...(executionNotices.get(message.uiId) ?? []).map((notice) => ({
      kind: "notice" as const,
      id: notice.uiId,
      message: notice,
    })),
  );
  const processTools: ToolProgress[] = processSegments.flatMap((segment) =>
    segment.kind === "execution" ? segment.tools : [],
  );
  // The settled aggregate is ONE row for every execution segment, so its
  // "worked for" span is the measured sum of those segments. The message's
  // own process span wins when the runtime reported one.
  const processSpanMs = processSegments.reduce<number | undefined>(
    (total, segment) =>
      segment.kind === "execution" && segment.processMs !== undefined
        ? (total ?? 0) + segment.processMs
        : total,
    undefined,
  );
  const resultSource = joinTextSources(resultSegments.map(segment=>segment.kind === "text" ? segment : {text:"",sources:[]}), "\n\n");
  const resultText = resultSource.text.trim();
  const resultStreaming = !!message.streaming;
  const processStreaming = resultStreaming && resultText.length === 0;
  // Thinking segments stay in the series, each in its own row, so the turn
  // collapses into ONE aggregate process row that expands back to the exact
  // sequence the model produced (think → tool → think). Concatenating them
  // into one top-level thought blob pasted every later segment inside the
  // first one.
  const hasLifecycleRecords = flow.some(segment => segment.kind === "compaction" || segment.kind === "retry");
  const compacting = flow.some(segment => segment.kind === "compaction" && segment.compaction.status === "running");
  // The execution tail owns its live label or its completed row + fallback.
  // Historical disclosures above subsequent prose must not suppress it.
  const tailOwnsActivity = flow.at(-1)?.kind === "execution";
  const retrying = flow.at(-1)?.kind === "retry";
  // A turn whose only content so far is thought needs no separate "working"
  // tail — the thought row itself is the activity.
  const hasPostThoughtContent = flow.length > 0 || resultText.length > 0;
  const showRunning = !retrying && resultStreaming && !awaitingUserInput && !compacting && !tailOwnsActivity && hasPostThoughtContent;

  const flowRef = useRef<HTMLDivElement>(null);
  const liveHeight = useRef(0);
  const liveResultTop = useRef<number | null>(null);
  const wasStreaming = useRef(resultStreaming);
  useLayoutEffect(() => {
    const node = flowRef.current;
    if (!node) return;
    const completing = wasStreaming.current && !resultStreaming;
    wasStreaming.current = resultStreaming;
    if (resultStreaming) {
      const measure = () => {
        const bounds = node.getBoundingClientRect();
        liveHeight.current = bounds.height;
        const text = node.querySelector<HTMLElement>("[data-live-tail]");
        liveResultTop.current = text
          ? text.getBoundingClientRect().top - bounds.top
          : null;
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    }
    const height = node.getBoundingClientRect().height;
    if (
      !completing ||
      liveHeight.current <= height ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      !node.animate
    )
      return;
    // Animate actual layout height so native scroll anchoring can follow the
    // shrink. Never force-scroll: someone may be reading an earlier turn.
    const animation = node.animate(
      [{ height: `${liveHeight.current}px` }, { height: `${height}px` }],
      { duration: 180, easing: "ease-out" },
    );
    const result = node.querySelector<HTMLElement>("[data-turn-result]");
    const resultAnimation =
      result && liveResultTop.current !== null
        ? result.animate(
            [
              {
                transform: `translateY(${liveResultTop.current - (result.getBoundingClientRect().top - node.getBoundingClientRect().top)}px)`,
              },
              { transform: "translateY(0)" },
            ],
            { duration: 180, easing: "ease-out" },
          )
        : undefined;
    return () => {
      animation.cancel();
      resultAnimation?.cancel();
    };
  }, [resultStreaming]);

  // The thought stream joins the same aggregate as the tools: one collapsed
  // process row whose summary reads "思考了 X 秒 · N 次工具调用", with the
  // full thought text as the first nested detail.
  const clusterDetails: TurnTraceDetail[] =
    trace.reasoningText.length > 0 &&
    !message.assistantTimeline?.some((item) => item.kind === "reasoning")
      ? [
          {
            kind: "reasoning" as const,
            id: `${message.uiId}:reasoning`,
            text: trace.reasoningText,
            reasoningMs: message.reasoningMs,
          },
          ...processDetails,
        ]
      : processDetails;

  return (
    <div data-background-surface="assistant-message" data-selection="text" className="min-w-0 px-4 py-3 text-sm">
      <div ref={flowRef} className="flex min-w-0 flex-col gap-2">
        {resultStreaming || hasLifecycleRecords ? (
          <>
            {trace.reasoningText.length > 0 &&
              !message.assistantTimeline?.some(
                (item) => item.kind === "reasoning",
              ) && (
                <ExecutionDisclosure
                  details={clusterDetails.filter(
                    (detail) => detail.kind === "reasoning",
                  )}
                  tools={[]}
                  streaming={resultStreaming && flow.length === 0 && !awaitingUserInput}
                />
              )}
            {flow.map((segment, index) =>
              segment.kind === "retry" ? (
                <div key={segment.id} role="status" className="px-1.5 text-xs text-muted-foreground" data-retry-attempt={segment.retry.attempt}>
                  {t(resultStreaming && index === flow.length - 1 ? (segment.retry.status === "waiting" ? "sidepanel.retry.waiting" : "sidepanel.retry.started") : "sidepanel.retry.record", { attempt: segment.retry.attempt, seconds: Math.ceil(segment.retry.delayMs / 1000) })}
                </div>
              ) : segment.kind === "compaction" ? (
                <CompactionRow key={segment.id} compaction={segment.compaction} live={resultStreaming} />
              ) : segment.kind === "text" ? (
                <div
                  key={segment.id}
                  data-live-tail={index === flow.length - 1 ? "" : undefined}
                >
                  <WorkspaceMarkdown
                    sources={segment.sources}
                    components={chatMarkdownComponents}
                    mode={resultStreaming ? "streaming" : "static"}
                    parseIncompleteMarkdown
                    caret="circle"
                    isAnimating={
                      resultStreaming && index === flow.length - 1 && !awaitingUserInput
                    }
                    className="chat-md break-words"
                  >
                    {segment.text}
                  </WorkspaceMarkdown>
                </div>
              ) : (
                <ExecutionDisclosure
                  key={segment.id}
                  details={segment.details}
                  tools={segment.tools}
                  streaming={resultStreaming && index === flow.length - 1 && !awaitingUserInput}
                  processMs={segment.processMs}
                  defaultExpanded={resultStreaming}
                />
              ),
            )}
            {(executionNotices.get(message.uiId) ?? []).map((notice) => (
              <Bubble key={notice.uiId} m={notice} />
            ))}
          </>
        ) : (
          <>
            {clusterDetails.length > 0 && (
              <ExecutionDisclosure
                details={clusterDetails}
                tools={processTools}
                streaming={processStreaming}
                processMs={message.processMs ?? processSpanMs}
              />
            )}
            {resultText.length > 0 && (
              <div data-turn-result>
                <WorkspaceMarkdown
                  sources={sliceTextSources(resultSource,resultText)}
                  components={chatMarkdownComponents}
                  mode={resultStreaming ? "streaming" : "static"}
                  parseIncompleteMarkdown
                  caret="circle"
                  isAnimating={resultStreaming}
                  className="chat-md break-words"
                >
                  {resultText}
                </WorkspaceMarkdown>
              </div>
            )}
          </>
        )}
        {showRunning && <TurnRunningIndicator />}
      </div>
      {!message.streaming &&
        message.agentFinalUrl &&
        onOpenAgentDestination && (
          <AgentDestinationChip
            url={message.agentFinalUrl}
            title={message.agentFinalTitle}
            onOpen={onOpenAgentDestination}
          />
        )}
      {runBoundary && (
        <RunBoundary
          state={runBoundary}
          followsContent={flow.length > 0 || hasFinalDestination}
        />
      )}
    </div>
  );
}

/**
 * Memoized bubble. The comparator is React's default shallow compare, so a
 * bubble re-renders only when its message identity, its structural flags, or
 * one of the shell's render-prop capabilities actually changes.
 *
 * What this buys: any ChatSurface render that is NOT caused by the message
 * list (composer typing, busy/error toggles, layout state) now leaves every
 * completed bubble untouched instead of re-running each bubble body.
 *
 * What it does not buy yet: a streaming flush also re-renders the shell above
 * ChatSurface, which rebuilds the inline slot arrows (e.g. `messageImages` in
 * product-shell) with a fresh identity — that churn defeats the compare for
 * that render path. Stabilizing those slot identities at the shell is the
 * follow-up; deliberately ignoring them here is not an option because the
 * slot can legitimately change or disappear (MessageChrome covers that).
 */
export const Bubble = memo(BubbleUnmemoized);

function useMessageGlass(complete: boolean, align: "left" | "right") {
  const chromeRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    const body = chrome?.querySelector<HTMLElement>("[data-message-glass-body]");
    const tab = chrome?.querySelector<HTMLElement>('[data-background-surface="message-actions"]');
    if (!chrome || !body) return;
    const measure = () => {
      const w = chrome.clientWidth, h = body.offsetHeight;
      if (!w || !h) return;
      const th = tab?.offsetHeight ?? 0;
      const tw = Math.min(tab?.offsetWidth ?? 0, w - 20);
      // Alpha-mask the final filtered pixels, not just the layer geometry.
      const path = `M12 0 H${w-12} Q${w} 0 ${w} 12 V${h-12} Q${w} ${h} ${w-12} ${h} H${tw+8} Q${tw} ${h} ${tw} ${h+8} V${h+th-12} Q${tw} ${h+th} ${tw-12} ${h+th} H12 Q0 ${h+th} 0 ${h+th-12} V12 Q0 0 12 0 Z`;
      const closedPath = `M12 0 H${w-12} Q${w} 0 ${w} 12 V${h-12} Q${w} ${h} ${w-12} ${h} H${tw+8} Q${tw} ${h} ${tw} ${h} V${h} Q${tw} ${h} ${tw} ${h} H12 Q0 ${h} 0 ${h-12} V12 Q0 0 12 0 Z`;
      const mirror = align === "right" ? `translate(${w} 0) scale(-1 1)` : "";
      const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h+th}" viewBox="0 0 ${w} ${h+th}">${th ? `<path d="${path}" transform="${mirror}" fill="white"/>` : `<rect width="${w}" height="${h}" rx="12" fill="white"/>`}</svg>`;
      chrome.style.setProperty("--assistant-glass-mask", `url("data:image/svg+xml,${encodeURIComponent(mask)}")`);
      const closedMask = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h+th}" viewBox="0 0 ${w} ${h+th}"><rect width="${w}" height="${h}" rx="12" fill="white"/></svg>`;
      chrome.style.setProperty("--assistant-glass-mask-closed", `url("data:image/svg+xml,${encodeURIComponent(closedMask)}")`);
      chrome.style.setProperty("--assistant-glass-closed", th ? `path('${closedPath}')` : "inset(0 round 12px)");
      chrome.style.setProperty("--assistant-glass-outline", th ? `path('${path}')` : "inset(0 round 12px)");
      chrome.style.setProperty("--message-glass-height", `${h+th}px`);
      chrome.setAttribute("data-unified-glass", "");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chrome);
    observer.observe(body);
    if (tab) observer.observe(tab);
    return () => observer.disconnect();
  }, [complete, align]);
  return chromeRef;

}

function ReplyTokenUsage({ messages }: { messages: UiMessage[] }) {
  const { t } = useT();
  // Execution rows can repeat the same message; count each runtime turn once.
  const byTurn = new Map<string, NonNullable<UiMessage["tokenUsage"]>>();
  for (const message of messages) if (message.tokenUsage) {
    byTurn.set(message.runtimeTurn === undefined ? message.uiId : `turn:${message.runtimeTurn}`, message.tokenUsage);
  }
  const rows = [...byTurn.values()];
  if (!rows.length) return null;
  const keys = ["inputTokens", "outputTokens", "cacheWriteTokens", "cacheReadTokens"] as const;
  const totals = keys.map(key => rows.every(row => row[key] !== undefined)
    ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0) : undefined);
  const outputTokens = rows.reduce((sum, row) => sum + row.outputTokens, 0);
  const format = (value: number) => value.toLocaleString();
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" aria-label={t("sidepanel.tokens.details")} className="ml-1 rounded px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {t("sidepanel.tokens.outputTokens")} {format(outputTokens)} tokens
      </button>
    </TooltipTrigger>
    <TooltipContent side="bottom" className="min-w-40 text-xs">
      <div className="mb-2 font-medium">{t("sidepanel.tokens.details")}</div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-1">
        {keys.map((key, index) => <Fragment key={key}><dt>{t(`sidepanel.tokens.${key}`)}</dt><dd className="text-right tabular-nums">{totals[index] === undefined ? t("sidepanel.tokens.unreported") : format(totals[index]!)}</dd></Fragment>)}
      </dl>
    </TooltipContent>
  </Tooltip>;
}

function AssistantReplyChrome({ messages, copyText, children, actions, timeFormat, timeLocale }: {
  messages: UiMessage[];
  copyText: string;
  children: ReactNode;
  actions?: (messageId: string) => ReactNode;
  timeFormat: TimeFormatPreference;
  timeLocale?: string;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const complete = messages.every(message => !message.streaming);
  const chromeRef = useMessageGlass(complete, "left");
  const last = messages.at(-1);
  const text = copyText;
  const time = formatMessageTime(last?.sentAt, timeFormat, timeLocale);
  return <div ref={chromeRef} data-assistant-message-chrome className="group min-w-0">
    <div data-assistant-glass-clip aria-hidden="true"><div data-assistant-glass-material /></div>
    <div data-assistant-reply-body data-message-glass-body>{children}</div>
    {complete && <TooltipProvider delayDuration={180} skipDelayDuration={80}>
      <div data-background-surface="message-actions" data-action-align="left"
        className="pointer-events-none flex h-7 w-fit max-w-full items-center gap-1 px-2 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <UserActionButton label={t(copied ? "common.copied" : "common.copy")} icon={copied ? <Check /> : <Copy />} onClick={() => {
          if (navigator.clipboard) void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => undefined);
        }} />
        {time && <time dateTime={time.dateTime} className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">{time.label}</time>}
        <ReplyTokenUsage messages={messages} />
        {last?.assistantMessageId ? actions?.(last.assistantMessageId) : null}
      </div>
    </TooltipProvider>}
  </div>;
}

/**
 * Sticky user-question strip with a static height cap.
 *
 * Long bubbles are always capped; a fade overlay + a "more" button appear at
 * the bottom when content overflows the cap. Short bubbles render unmodified.
 * No scroll listener, no layout feedback loop, no flicker.
 */
function UserStickyBubbleUnmemoized({
  m,
  messageImages,
  onOpenAgentDestination,
  userOrdinal,
  onBranch,
  onRestore,
  timeFormat,
  timeLocale,
}: {
  m: UiMessage;
  messageImages?: BubbleProps["messageImages"];
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"];
  userOrdinal: number;
  onBranch?: (message: UiMessage, userOrdinal: number) => void | Promise<void>;
  onRestore?: (message: UiMessage, userOrdinal: number) => void | Promise<void>;
  timeFormat: TimeFormatPreference;
  timeLocale?: string;
}) {
  const { t } = useT();
  const chromeRef = useMessageGlass(!m.streaming, "right");
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => {
      setOverflowed(inner.scrollHeight > CAPPED_HEIGHT_PX + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!overflowed && expanded) setExpanded(false);
  }, [overflowed, expanded]);


  const isClipping = overflowed && !expanded;
  const messageTime = formatMessageTime(m.sentAt, timeFormat, timeLocale);
  const copyMessage = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard
      .writeText(stripManagedResourceContext(bubbleTextContent(m.content)))
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <div className="sticky top-0 z-20">
      <TooltipProvider delayDuration={180} skipDelayDuration={80}>
        <div ref={chromeRef} data-user-message-chrome className="group pb-1">
          <div data-assistant-glass-clip aria-hidden="true"><div data-assistant-glass-material /></div>
          <div data-message-glass-body className="relative">
            <div
              data-background-surface="sticky-message"
              onClick={
                isClipping
                  ? (event) => {
                      // Tap anywhere on the clipped bubble expands it; let
                      // interactive children (links, buttons, inputs) keep
                      // their own behaviour.
                      const target = event.target as HTMLElement;
                      if (
                        target.closest(
                          "a,button,input,textarea,[contenteditable='true'],[role='button']",
                        )
                      ) {
                        return;
                      }
                      setExpanded(true);
                    }
                  : undefined
              }
              className={cn(
                "rounded-xl",
                isClipping && "cursor-pointer",
                expanded
                  ? `${EXPANDED_MAX_HEIGHT_CLASS} overflow-y-auto`
                  : `${CAPPED_HEIGHT_CLASS} overflow-hidden`,
              )}
            >
              <div ref={innerRef}>
                <Bubble m={m} messageImages={messageImages} onOpenAgentDestination={onOpenAgentDestination} />
              </div>
            </div>
            {isClipping && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-xl bg-gradient-to-t from-secondary to-transparent"
              />
            )}
            {overflowed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-label={t(
                      expanded
                        ? "sidepanel.message.collapse"
                        : "sidepanel.message.expand",
                    )}
                    className={cn(
                      "absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center",
                      "rounded-md text-muted-foreground/60 transition-colors",
                      "hover:bg-accent/70 hover:text-foreground",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    )}
                  >
                    {expanded ? (
                      <ChevronUp className="h-3 w-3" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px]">
                  {t(
                    expanded
                      ? "sidepanel.message.collapse"
                      : "sidepanel.message.expand",
                  )}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {!m.streaming ? (
            <div
              data-testid="user-message-actions"
              data-action-align="right"
              data-background-surface="message-actions"
              className="pointer-events-none ml-auto flex h-7 w-fit items-center justify-end gap-1 px-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            >
              {messageTime ? (
                <time
                  dateTime={messageTime.dateTime}
                  className="mr-1 shrink-0 whitespace-nowrap text-[10px] tabular-nums leading-none text-muted-foreground"
                >
                  {messageTime.label}
                </time>
              ) : null}
              <UserActionButton
                label={t(copied ? "common.copied" : "common.copy")}
                icon={copied ? <Check /> : <Copy />}
                onClick={copyMessage}
              />
              {onRestore ? (
                <UserActionButton
                  label={t("sidepanel.message.restoreWorkspace")}
                  icon={<Undo2 />}
                  onClick={() => void onRestore(m, userOrdinal)}
                />
              ) : null}
              {onBranch ? (
                <UserActionButton
                  label={t("sidepanel.message.branch")}
                  icon={<GitFork />}
                  onClick={() => void onBranch(m, userOrdinal)}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </TooltipProvider>
    </div>
  );
}

/**
 * Memoized sticky user bubble. Default shallow compare: the user message
 * reference is stable for every turn except the one being updated, so renders
 * that do not touch that turn (composer typing, layout state) skip its body
 * entirely. A streaming flush still rebuilds the shell's slot arrows, so that
 * path bails only once those identities are stabilized at the shell.
 */
export const UserStickyBubble = memo(UserStickyBubbleUnmemoized);

/**
 * One rendered conversation row: an optional user prompt (null when the turn
 * is assistant-only — a host-started reply or a notice at the head of the
 * history) plus the assistant replies grouped under it. Shared by the bubble
 * renderer and the ConversationTurnRail, so marker count, order and row
 * identity stay in lockstep with the DOM.
 */
export interface ConversationTurn {
  user: UiMessage | null;
  replies: UiMessage[];
  userOrdinal: number;
}

/**
 * The part of the conversation the message list currently renders. Long
 * histories are windowed to the newest `MESSAGE_TURN_WINDOW` turns; the rail
 * must only offer markers for turns that are actually in the DOM, or its
 * ordinal alignment (and therefore its highlight and jump targets) drift.
 */
export interface ConversationTurnsWindow {
  visible: readonly ConversationTurn[];
  hidden: number;
}

/**
 * Group the flat message list into "turns" (one user message + the assistant
 * replies that follow it, up to the next user message) and pin each user
 * bubble to the top of the scroll viewport via `position: sticky`. While the
 * reader scrolls through a long assistant reply, the originating question
 * stays visible — Cursor-style.
 */
export function MessageTurns({
  messageText,
  turnTail,
  timelineRows,
  turnTailAnchors,
  openTurnFile,
  assistantActions,
  messageImages,
  messages,
  sessionId,
  viewStateScope,
  onOpenAgentDestination,
  onReviewWorkspaceChanges,
  onBranchUserMessage,
  onRestoreBeforeTurn,
  restorableTurnOrdinals,
  onTurnsWindowChange,
}: {
  messageText?: (runtimeTurn:number|undefined,children:ReactNode,openFile:(path:string)=>void,timeline?: readonly import("@amiba/app-runtime/protocol").AssistantTimelineItem[])=>ReactNode;
  messageImages?: BubbleProps["messageImages"];
  assistantActions?: (messageId: string) => ReactNode;
  turnTail?: (runtimeTurn: number, openFile: (path: string) => void) => ReactNode;
  timelineRows?: readonly { id: string; seq: number; content: ReactNode; replaceMessageId?: string }[];
  turnTailAnchors?: readonly { runtimeTurn: number; endSeq: number }[];
  openTurnFile?: (path: string) => void;
  messages: UiMessage[];
  sessionId?: string;
  viewStateScope?: object;
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"];
  onReviewWorkspaceChanges?: (
    resource: WorkspaceReviewResource,
  ) => void | Promise<void>;
  onBranchUserMessage?: (
    message: UiMessage,
    userOrdinal: number,
  ) => void | Promise<void>;
  onRestoreBeforeTurn?: (
    message: UiMessage,
    userOrdinal: number,
  ) => void | Promise<void>;
  restorableTurnOrdinals?: ReadonlySet<number>;
  /**
   * Reports the currently rendered turn window (see `ConversationTurnsWindow`).
   * The ConversationTurnRail consumes this so its markers always address the
   * same turns the bubble renderer mounted — windowing would otherwise leave
   * the rail indexing turns that are not in the DOM.
   */
  onTurnsWindowChange?: (window: ConversationTurnsWindow) => void;
}) {
  const { language } = useT();
  const [timeFormat] = useStoredTimeFormatPreference(language);
  // The turn-grouping derivation (filters, sorts, splices, map building) was
  // previously recomputed from scratch on every render. During a streaming
  // flush ChatSurface re-renders at up to 60 fps, so this O(message-count)
  // work is memoized here; only `messages` / presentation-anchor inputs
  // trigger a rebuild, and the memoized Bubble components below bail for
  // every turn whose message references are unchanged.
  const derived = useMemo(() => {
    // Presentation-only anchors never enter the session store or submission history.
    const replacedMessages = new Set((timelineRows ?? []).flatMap(row => row.replaceMessageId ? [row.replaceMessageId] : []));
    const anchoredMessages = messages.filter(message => !replacedMessages.has(message.uiId));
    const presentTurns = new Set(messages.filter(message => message.role === "assistant").map(message => message.runtimeTurn));
    for (const anchor of [...(turnTailAnchors ?? [])].sort((a, b) => a.endSeq - b.endSeq)) {
      if (presentTurns.has(anchor.runtimeTurn)) continue;
      presentTurns.add(anchor.runtimeTurn);
      const next = anchoredMessages.findIndex(message => message.runtimeSeq !== undefined && message.runtimeSeq > anchor.endSeq);
      anchoredMessages.splice(next < 0 ? anchoredMessages.length : next, 0, {
        uiId: `turn-tail-anchor:${anchor.runtimeTurn}`, role: "assistant", content: "",
        runtimeTurn: anchor.runtimeTurn, runtimeSeq: anchor.endSeq,
      });
    }
    const extensionRows = new Map<string, ReactNode>();
    for (const row of [...(timelineRows ?? [])].sort((a, b) => a.seq - b.seq)) {
      const id = `extension-row:${row.id}`;
      extensionRows.set(id, row.content);
      const next = anchoredMessages.findIndex(message => message.runtimeSeq !== undefined && message.runtimeSeq > row.seq);
      anchoredMessages.splice(next < 0 ? anchoredMessages.length : next, 0, {
        uiId: id, role: "assistant", content: "", runtimeSeq: row.seq,
      });
    }
    const lastMessageForTurn = new Map<number, string>();
    for (const message of anchoredMessages) {
      if (message.role === "assistant" && message.runtimeTurn !== undefined)
        lastMessageForTurn.set(message.runtimeTurn, message.uiId);
    }
    const turns: ConversationTurn[] = [];
    let cur: ConversationTurn | null = null;
    let userOrdinal = 0;
    const executionNotices = new Map<string, UiMessage[]>();
    const callOwners = new Map<string, UiMessage>();
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const event of message.toolProgress ?? []) callOwners.set(event.toolCallId, message);
    }
    const visibleMessages = anchoredMessages.filter(message => {
      const placement = message.notice?.placement;
      if (placement?.kind !== "execution" || !sessionId || placement.sessionId !== sessionId) return true;
      const target = callOwners.get(placement.callId);
      if (!target) return true; // Missing history remains visible; never guess a nearby run.
      executionNotices.set(target.uiId, [...(executionNotices.get(target.uiId) ?? []), message]);
      return false;
    });
    for (const m of visibleMessages) {
      // Plugin notices use the wire's user role, but do not start a user turn.
      if (m.role === "user" && !m.notice) {
        cur = { user: m, replies: [], userOrdinal };
        userOrdinal += 1;
        turns.push(cur);
      } else if (cur) {
        cur.replies.push(m);
      } else {
        cur = { user: null, replies: [m], userOrdinal: -1 };
        turns.push(cur);
      }
    }
    return { turns, extensionRows, lastMessageForTurn, executionNotices };
  }, [messages, timelineRows, turnTailAnchors, sessionId]);
  const { turns, extensionRows, lastMessageForTurn, executionNotices } = derived;
  // Long histories are windowed: mounting one bubble tree per turn on every
  // session switch is what froze the app on continued conversations. Scrolling
  // above the sentinel pulls in the previous slice of turns. The slice is
  // memoized so its identity only changes when the window contents actually
  // change — `onTurnsWindowChange` (read by the ConversationTurnRail) must not
  // fire on every render of a streaming conversation.
  const [turnWindow, expandTurnWindow] = useConversationTurnWindow(sessionId, viewStateScope, turns.length);
  const windowSentinelRef = useRef<HTMLDivElement>(null);
  const { visible: visibleTurns, hidden: hiddenTurns } = useMemo(
    () => windowTurns(turns, turnWindow),
    [turns, turnWindow],
  );
  useEffect(() => {
    onTurnsWindowChange?.({ visible: visibleTurns, hidden: hiddenTurns });
  }, [onTurnsWindowChange, visibleTurns, hiddenTurns]);
  useEffect(() => {
    if (hiddenTurns === 0) return;
    const node = windowSentinelRef.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          expandTurnWindow();
      },
      // Preload before the user actually reaches the top of the history.
      { rootMargin: "400px 0px 0px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hiddenTurns, expandTurnWindow]);

  return (
    <>
      {hiddenTurns > 0 && (
        <div
          ref={windowSentinelRef}
          data-turn-window-sentinel=""
          aria-hidden="true"
          className="h-px w-full"
        />
      )}
      {visibleTurns.map((turn, i) => {
        const replyItems = buildTurnReplyItems(turn.replies);
        // Rendering can fold assistant rows into an execution disclosure or omit
        // an empty row. Locate the tail after the row's final rendered item,
        // without splitting the existing disclosure or adding idle DOM.
        const lastItemForMessage = new Map<string, number>();
        replyItems.forEach((item, index) => {
          if (item.kind === "message") lastItemForMessage.set(item.message.uiId, index);
          else if (item.kind === "execution") {
            for (const message of item.messages) lastItemForMessage.set(message.uiId, index);
          } else lastItemForMessage.set(item.id.slice("boundary:".length), index);
        });
        // Storage fragments do not create visual breaks in a continuous reply.
        // Notices and explicit run boundaries keep their own presentation.
        const replyGroups: Array<{ assistant: boolean; items: Array<{ item: TurnReplyItem; index: number }> }> = [];
        replyItems.forEach((item, index) => {
          const assistant = item.kind === "execution" || (item.kind === "message" && item.message.role === "assistant");
          const previous = replyGroups.at(-1);
          if (assistant && previous?.assistant) previous.items.push({ item, index });
          else replyGroups.push({ assistant, items: [{ item, index }] });
        });
        const extrasAfter = new Map<number, ReactNode[]>();
        const appendExtra = (index: number, node: ReactNode) => extrasAfter.set(index, [...(extrasAfter.get(index) ?? []), node]);
        let previousItem = -1;
        for (const message of turn.replies) {
          previousItem = Math.max(previousItem, lastItemForMessage.get(message.uiId) ?? -1);
          if (extensionRows.has(message.uiId)) appendExtra(previousItem, <Fragment key={message.uiId}>{extensionRows.get(message.uiId)}</Fragment>);
          if (message.role !== "assistant" || message.streaming || message.runtimeTurn === undefined ||
              lastMessageForTurn.get(message.runtimeTurn) !== message.uiId) continue;
          if (openTurnFile && turnTail) appendExtra(previousItem, <Fragment key={`tail:${message.runtimeTurn}`}>{turnTail(message.runtimeTurn, openTurnFile)}</Fragment>);
        }
        const renderTailsAfter = (index: number) => extrasAfter.get(index);
        if (!turn.user && replyItems.length === 0) {
          return <Fragment key={`empty-turns-${i}`}>{renderTailsAfter(-1)}</Fragment>;
        }
        const reviewResource = turn.replies.some((message) => message.streaming)
          ? null
          : workspaceReviewResourceFromEvents(
              turn.replies.flatMap((message) => message.toolProgress ?? []),
              `turn:${turn.user?.uiId ?? i}`,
            );
        return (
          <div
            key={turn.user?.uiId ?? `turn-${i}`}
            data-conversation-user-turn={turn.user?.uiId}
            // The user action row already separates the prompt from the first reply.
            className={cn(
              turn.user ? "[&>:nth-child(n+3)]:mt-2" : "space-y-2",
              "amiba-message-turn-cvi",
            )}
            // Long sessions rendered hundreds of fully laid-out turns; the
            // browser now skips layout/paint of turns entirely outside the
            // viewport. The sticky user bubble still works: a partially
            // visible turn is rendered (not skipped), so the pin re-establishes
            // as soon as its container enters the viewport.
            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 160px" }}
          >
            {turn.user && (
              <UserStickyBubble
                messageImages={messageImages}
                m={turn.user}
                onOpenAgentDestination={onOpenAgentDestination}
                userOrdinal={turn.userOrdinal}
                onBranch={onBranchUserMessage}
                onRestore={
                  restorableTurnOrdinals?.has(turn.userOrdinal)
                    ? onRestoreBeforeTurn
                    : undefined
                }
                timeFormat={timeFormat}
                timeLocale={language}
              />
            )}
            <ExecutionNoticesContext.Provider value={executionNotices}>
            {renderTailsAfter(-1)}
            {replyGroups.map(group => {
              const content = group.items.map(({ item, index: itemIndex }) => {
              if (item.kind === "execution") {
                return (
                  <Fragment key={item.id}><TurnExecutionDisclosure
                    messages={item.messages}
                  />{renderTailsAfter(itemIndex)}</Fragment>
                );
              }
              if (item.kind === "boundary") {
                return <Fragment key={item.id}><RunBoundary state={item.state} />{renderTailsAfter(itemIndex)}</Fragment>;
              }

              return (
                <Fragment key={item.id}>{item.message.role === "assistant" && messageText && openTurnFile
                  ? messageText(item.message.runtimeTurn, <Bubble
                  m={item.message}
                  messageImages={messageImages}
                  suppressTrace={item.suppressTrace}
                  suppressRunBoundary={item.suppressRunBoundary}
                  onOpenAgentDestination={onOpenAgentDestination}
                />, openTurnFile, messageTextTimeline(item.message))
                  : <Bubble
                  m={item.message}
                  messageImages={messageImages}
                  suppressTrace={item.suppressTrace}
                  suppressRunBoundary={item.suppressRunBoundary}
                  onOpenAgentDestination={onOpenAgentDestination}
                />}
                {renderTailsAfter(itemIndex)}
                </Fragment>
              );
              });
              const groupMessages = group.items.flatMap(({ item }) => item.kind === "execution" ? item.messages : item.kind === "message" ? [item.message] : []);
              // Copy the same prose that the reply renderer exposes, never the
              // persisted content that also contains execution narration.
              const copyText = group.items.flatMap(({ item }) => {
                if (item.kind !== "message" || item.message.role !== "assistant") return [];
                if (!item.suppressTrace && hasInterleavedAssistantTimeline(item.message)) {
                  const flow = buildAssistantFlow(item.message);
                  const visible = flow.some(segment => segment.kind === "compaction" || segment.kind === "retry")
                    ? flow : splitTrailingTextRun(flow).tail;
                  return visible.flatMap(segment => segment.kind === "text" ? [segment.text] : []);
                }
                return [resolveAssistantTrace(item.message).bodyText];
              }).map(stripManagedResourceContext).filter(value => value.trim()).join("\n\n");
              const ownsReview = group === [...replyGroups].reverse().find(candidate => candidate.assistant);
              const body = group.assistant
                ? <div data-assistant-reply-group data-background-surface="assistant-message">
                    {content}
                    {ownsReview && reviewResource && onReviewWorkspaceChanges && <div className="px-4 pb-3">
                      <WorkspaceChangesCard resource={reviewResource} onReview={onReviewWorkspaceChanges} />
                    </div>}
                  </div>
                : content;
              return group.assistant && groupMessages.some(message => bubbleTextContent(message.content).trim())
                ? <AssistantReplyChrome key={group.items[0]!.item.id} messages={groupMessages} copyText={copyText} actions={assistantActions} timeFormat={timeFormat} timeLocale={language}>{body}</AssistantReplyChrome>
                : <Fragment key={group.items[0]!.item.id}>{body}</Fragment>;
            })}
            </ExecutionNoticesContext.Provider>
            {!replyGroups.some(group => group.assistant) && reviewResource && onReviewWorkspaceChanges ? (
              <WorkspaceChangesCard
                resource={reviewResource}
                onReview={onReviewWorkspaceChanges}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function WorkspaceChangesCard({
  resource,
  onReview,
}: {
  resource: WorkspaceReviewResource;
  onReview(resource: WorkspaceReviewResource): void | Promise<void>;
}) {
  const { t } = useT();
  const openFile = useWorkspaceFileOpener();
  const [expanded, setExpanded] = useState(false);
  const review = parseWorkspaceReview(resource.entries);
  const visibleFiles = expanded ? review.files : review.files.slice(0, 3);
  const remaining = Math.max(0, review.files.length - visibleFiles.length);

  // A quiet footnote under the turn, not a second card: one slim summary
  // line with the review action, then the touched files — each a link into
  // the workbench when the shell can open files.
  return (
    <section
      data-background-surface="assistant-message"
      aria-label={t("workspacePane.filesChanged", {
        count: review.files.length,
      })}
      className="overflow-hidden rounded-lg border border-border/45 bg-chat-surface"
    >
      <div className="flex min-h-8 items-center gap-2 px-2.5 py-1">
        <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">
            {t("workspacePane.filesChanged", { count: review.files.length })}
          </span>
          {review.additions > 0 || review.deletions > 0 ? (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">
                +{review.additions}
              </span>
              <span className="text-red-600 dark:text-red-400">
                -{review.deletions}
              </span>
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => void onReview(resource)}
          className="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-chat-surface-hover hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          {t("workspacePane.review")}
        </button>
      </div>
      <ul className="border-t border-border/35 px-2.5 py-1">
        {visibleFiles.map((file) => {
          const label = compactWorkspacePath(file.path, 6);
          const stats = (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
              {file.additions > 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{file.additions}
                </span>
              ) : null}
              {file.deletions > 0 ? (
                <span className="text-red-600 dark:text-red-400">
                  -{file.deletions}
                </span>
              ) : null}
            </span>
          );
          return (
            <li
              key={file.path}
              className="flex min-h-7 min-w-0 items-center gap-3 text-[11px]"
            >
              {openFile ? (
                <button
                  type="button"
                  onClick={() => void openFile({ path: file.path })}
                  title={t("sidepanel.trace.searchResults.openFile")}
                  className="min-w-0 flex-1 truncate text-left font-mono text-foreground/72 transition-colors hover:text-primary hover:underline focus:outline-none focus-visible:text-primary"
                >
                  {label}
                </button>
              ) : (
                <span
                  className="min-w-0 flex-1 truncate font-mono text-foreground/72"
                  title={file.path}
                >
                  {label}
                </span>
              )}
              {stats}
            </li>
          );
        })}
        {remaining > 0 || expanded ? (
          <li>
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="inline-flex min-h-7 items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {expanded
                ? t("workspacePane.showFewerFiles")
                : t("workspacePane.showMoreFiles", { count: remaining })}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function UserActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:h-3.5 [&_svg]:w-3.5"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function MessageImages({ images, render, compact = false }: {
  images: NonNullable<UiMessage["images"]>;
  render: NonNullable<BubbleProps["messageImages"]>;
  compact?: boolean;
}) { return render(images, compact); }
