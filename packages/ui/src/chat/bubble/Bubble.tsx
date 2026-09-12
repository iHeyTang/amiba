import { messageTextTimeline, joinTextSources, sliceTextSources, timelineTextSource, thinkingBodySource, type TextSourceRange } from "../text-source-ranges";
import { WorkspaceMarkdown } from "../workspace-file-links";
import { CompactionRow } from "./CompactionRow";
import type { CompactionProgress } from "@amiba/app-runtime/protocol";
import { Fragment } from "react";
import { MessageDecoration } from "../../primitives/empty-state-visual";
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
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChatMarkdown as Streamdown } from "@amiba/markdown";
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
            ? "cursor-pointer hover:bg-muted/45 hover:text-foreground"
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
    timeline.some(item => item.kind === "reasoning" || item.kind === "compaction") ||
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
export function Bubble({
  m,
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
      const fallback = (
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
    const hasReferences = fileBadges.length > 0;
    const hasContent = bodyText.length > 0;
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
        className="min-w-0 rounded-xl border border-border/60 bg-secondary px-4 py-3 text-sm text-secondary-foreground"
      >
        {sourceLabel && (
          <div
            data-testid="message-source"
            className="mb-2 inline-flex rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground"
          >
            {t("sidepanel.message.from", { source: sourceLabel })}
          </div>
        )}
        {hasReferences && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-1.5",
              hasContent && "mb-2",
            )}
          >
            {fileBadges.map((b) => (
              <AttachmentBadgeView key={b.uiId} badge={b} />
            ))}
          </div>
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
      return (
        <div className="px-1 py-1 text-sm" aria-live="polite">
          <div className="inline-flex max-w-full items-center text-muted-foreground">
            <span className="agent-thinking-text truncate">
              {t("sidepanel.trace.thinking")}
            </span>
          </div>
        </div>
      );
    }

    const awaitingAnswerOnly =
      !!m.streaming &&
      !hasBody &&
      trace.toolProgress.length > 0 &&
      !trace.hasRunningTool &&
      trace.reasoningText.length === 0;

    // Body text that is still streaming ends in Streamdown's caret, but
    // once the prose settles and the model moves on to its next call there
    // is nothing animated left on screen — say the turn is still running.
    const showRunning = !!m.streaming && hasBody && !awaitingUserInput;

    return (
      <div data-selection="text" className="min-w-0 px-1 py-1 text-sm">
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
              streaming={!!m.streaming && !hasBody}
              latestProgress={
                m.streaming && hasReasoningFold
                  ? compactProgressNote(trace.reasoningText)
                  : ""
              }
              liveReasoning={m.streaming ? trace.reasoningText : ""}
              processMs={m.processMs}
            />
            {awaitingAnswerOnly && (
              <div
                className="inline-flex min-h-7 items-center px-1.5 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                <span className="agent-thinking-text">
                  {t("sidepanel.trace.generating")}
                </span>
              </div>
            )}
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
      className="mx-3 rounded-md bg-muted/50 p-2 font-mono text-xs"
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
        className="group/trace inline-flex min-h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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

const noNavigationSubscribe = () => () => {};
const idleNavigation = {callId:"",version:0};
const noNavigationRequest = () => idleNavigation;
function ExecutionDisclosure({
  details,
  tools,
  streaming,
  latestProgress = "",
  liveReasoning = "",
  processMs,
}: {
  details: TurnTraceDetail[];
  tools: ToolProgress[];
  streaming: boolean;
  latestProgress?: string;
  /** Full accumulated reasoning while streaming; renders the live pane. */
  liveReasoning?: string;
  processMs?: number;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);

  const navigation = useToolCallSeat()?.navigation;
  const navigationRequest = useSyncExternalStore(navigation?.subscribe ?? noNavigationSubscribe, navigation?.getSnapshot ?? noNavigationRequest);
  const handledNavigation = useRef(0);
  useEffect(()=>{if(navigationRequest.version !== handledNavigation.current && tools.some(tool=>tool.toolCallId === navigationRequest.callId)){handledNavigation.current=navigationRequest.version;setExpanded(true);}},[navigationRequest, tools]);

  if (details.length === 0 && !latestProgress) return null;

  const runningTool = [...tools]
    .reverse()
    .find((event) => event.status === "running");
  // A tool's `running` record is replaced by its `completed` record before
  // the overall assistant stream ends. Keep that latest meaningful activity
  // in the collapsed summary instead of briefly falling back to a generic
  // "generating" label between consecutive tool calls.
  const summaryTool =
    runningTool ?? (streaming ? tools[tools.length - 1] : undefined);
  const hasDetails = details.length > 0;
  const thought = details.find(
    (detail): detail is Extract<TurnTraceDetail, { kind: "reasoning" }> =>
      detail.kind === "reasoning",
  );
  // One natural phrase, not a data pile: total effort when tools ran,
  // thought duration when the turn was reasoning-only.
  const completedLabel =
    tools.length > 0 && typeof processMs === "number" && processMs > 0
      ? workedLabel(t, processMs)
      : thought
        ? thoughtLabel(t, thought.reasoningMs)
        : tools.length > 0
          ? t("sidepanel.trace.toolCount", { count: tools.length })
          : latestProgress || t("sidepanel.trace.executionDetails");
  const showLiveReasoning = streaming && !expanded && liveReasoning.length > 0;
  const summaryLabel = summaryTool
    ? <ToolChip event={summaryTool} mode="summary" />
    : streaming
      ? // With the live pane open the full text is already on screen; a
        // one-line ticker above it would just repeat its last fragment.
        showLiveReasoning
        ? t("sidepanel.trace.thinking")
        : latestProgress || t("sidepanel.trace.thinking")
      : completedLabel;

  return (
    <div className="min-w-0 text-sm" data-execution-summary>
      <button
        type="button"
        disabled={!hasDetails}
        aria-expanded={hasDetails ? expanded : undefined}
        title={
          hasDetails
            ? expanded
              ? t("sidepanel.trace.collapseDetails")
              : t("sidepanel.trace.expandDetails")
            : latestProgress
        }
        onClick={() => hasDetails && setExpanded((value) => !value)}
        className={cn(
          "group/run inline-flex min-h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          hasDetails
            ? "cursor-pointer hover:bg-muted/45 hover:text-foreground"
            : "cursor-default",
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate",
            streaming && "agent-thinking-text",

          )}
        >
          {summaryLabel}
        </span>
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
      {showLiveReasoning && <LiveReasoningPane text={liveReasoning} />}
      {expanded && hasDetails && (
        <div className="ml-[7px] flex min-w-0 flex-col gap-0.5 border-l border-border/60 py-1.5 pl-3 pr-1">
          {details.map((detail) => {
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
function TurnExecutionDisclosure({ messages }: { messages: UiMessage[] }) {
  const notices = useContext(ExecutionNoticesContext);
  const details: TurnTraceDetail[] = [];
  const tools: ToolProgress[] = [];
  const seenToolIds = new Set<string>();
  const seenApprovalIds = new Set<string>();
  let latestProgress = "";
  let liveReasoning = "";

  for (const message of messages) {
    for (const notice of notices.get(message.uiId) ?? []) details.push({ kind: "notice", id: notice.uiId, message: notice });
    const trace = resolveAssistantTrace(message);
    if (message.streaming && trace.reasoningText) {
      latestProgress = compactProgressNote(trace.reasoningText);
      liveReasoning = trace.reasoningText;
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
        streaming={messages.some((message) => message.streaming)}
        latestProgress={latestProgress}
        liveReasoning={liveReasoning}
        processMs={messages.reduce(
          (total, message) => total + (message.processMs ?? 0),
          0,
        )}
      />
    </div>
  );
}

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
  | { kind: "compaction"; id: string; compaction: CompactionProgress }
  | { kind: "text"; id: string; text: string; sources: TextSourceRange[] }
  | {
      kind: "execution";
      id: string;
      details: TurnTraceDetail[];
      tools: ToolProgress[];
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

  const flushExecution = () => {
    if (pendingDetails.length === 0) return;
    flow.push({
      kind: "execution",
      id: pendingDetails[0]!.id,
      details: pendingDetails,
      tools: pendingTools,
    });
    pendingDetails = [];
    pendingTools = [];
  };
  const appendText = (id: string, text: string, sources: TextSourceRange[] = []) => {
    const body = splitThinkingFromBody(text).body;
    if (!body.trim()) return;
    flushExecution();
    flow.push({ kind: "text", id, text: body, sources: sliceTextSources(thinkingBodySource({text,sources}),body) });
  };
  const appendTool = (id: string, toolCallId: string) => {
    if (seenTools.has(toolCallId)) return;
    const event = tools.get(toolCallId);
    if (!event) return;
    seenTools.add(toolCallId);
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
      pendingDetails.push({kind:"reasoning",id:item.id,text:item.text,reasoningMs:item.startedAt !== undefined && item.endedAt !== undefined ? Math.max(0,item.endedAt-item.startedAt) : undefined});
    } else if (item.kind === "tool") {
      appendTool(item.id, item.toolCallId);
    } else if (item.kind === "compaction") {
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
  const resultSource = joinTextSources(resultSegments.map(segment=>segment.kind === "text" ? segment : {text:"",sources:[]}), "\n\n");
  const resultText = resultSource.text.trim();
  const resultStreaming = !!message.streaming;
  const processStreaming = resultStreaming && resultText.length === 0;
  const hasCompactions = flow.some(segment => segment.kind === "compaction");
  const compacting = flow.some(segment => segment.kind === "compaction" && segment.compaction.status === "running");
  const showRunning = resultStreaming && !awaitingUserInput && !compacting;

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
  const clusterProgress =
    !!message.streaming && trace.reasoningText.length > 0
      ? compactProgressNote(trace.reasoningText)
      : "";

  return (
    <div data-selection="text" className="min-w-0 px-1 py-1 text-sm">
      <div ref={flowRef} className="flex min-w-0 flex-col gap-2">
        {resultStreaming || hasCompactions ? (
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
                  streaming={resultStreaming && !awaitingUserInput}
                  latestProgress={clusterProgress}
                />
              )}
            {flow.map((segment, index) =>
              segment.kind === "compaction" ? (
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
                latestProgress={clusterProgress}
                processMs={message.processMs}
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
 * Sticky user-question strip with a static height cap.
 *
 * Long bubbles are always capped; a fade overlay + a "more" button appear at
 * the bottom when content overflows the cap. Short bubbles render unmodified.
 * No scroll listener, no layout feedback loop, no flicker.
 */
export function UserStickyBubble({
  m,
  onOpenAgentDestination,
  userOrdinal,
  onBranch,
  onRestore,
  timeFormat,
  timeLocale,
}: {
  m: UiMessage;
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"];
  userOrdinal: number;
  onBranch?: (message: UiMessage, userOrdinal: number) => void | Promise<void>;
  onRestore?: (message: UiMessage, userOrdinal: number) => void | Promise<void>;
  timeFormat: TimeFormatPreference;
  timeLocale?: string;
}) {
  const { t } = useT();
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

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
    <div className="sticky top-0 z-20 -mx-3 bg-background px-3">
      <TooltipProvider delayDuration={180} skipDelayDuration={80}>
        <div className="group">
          <div className="relative">
            <div
              className={cn(
                "rounded-xl",
                expanded
                  ? `${EXPANDED_MAX_HEIGHT_CLASS} overflow-y-auto`
                  : `${CAPPED_HEIGHT_CLASS} overflow-hidden`,
              )}
            >
              <div ref={innerRef}>
                <Bubble m={m} onOpenAgentDestination={onOpenAgentDestination} />
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
              className="pointer-events-none flex h-7 items-center justify-end gap-0.5 px-1.5 pt-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            >
              {messageTime ? (
                <time
                  dateTime={messageTime.dateTime}
                  className="mr-1 shrink-0 whitespace-nowrap text-[10px] tabular-nums leading-none text-muted-foreground/55"
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
  messages,
  sessionId,
  onOpenAgentDestination,
  onReviewWorkspaceChanges,
  onBranchUserMessage,
  onRestoreBeforeTurn,
  restorableTurnOrdinals,
}: {
  messageText?: (runtimeTurn:number|undefined,children:ReactNode,openFile:(path:string)=>void,timeline?: readonly import("@amiba/app-runtime/protocol").AssistantTimelineItem[])=>ReactNode;
  assistantActions?: (messageId: string) => ReactNode;
  turnTail?: (runtimeTurn: number, openFile: (path: string) => void) => ReactNode;
  timelineRows?: readonly { id: string; seq: number; content: ReactNode; replaceMessageId?: string }[];
  turnTailAnchors?: readonly { runtimeTurn: number; endSeq: number }[];
  openTurnFile?: (path: string) => void;
  messages: UiMessage[];
  sessionId?: string;
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
}) {
  const { language } = useT();
  const [timeFormat] = useStoredTimeFormatPreference(language);
  type Turn = {
    user: UiMessage | null;
    replies: UiMessage[];
    userOrdinal: number;
  };
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
  const turns: Turn[] = [];
  let cur: Turn | null = null;
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

  return (
    <>
      {turns.map((turn, i) => {
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
            className={turn.user ? "[&>:nth-child(n+3)]:mt-2" : "space-y-2"}
          >
            {turn.user && (
              <UserStickyBubble
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
            {replyItems.map((item, itemIndex) => {
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
                  suppressTrace={item.suppressTrace}
                  suppressRunBoundary={item.suppressRunBoundary}
                  onOpenAgentDestination={onOpenAgentDestination}
                />, openTurnFile, messageTextTimeline(item.message))
                  : <Bubble
                  m={item.message}
                  suppressTrace={item.suppressTrace}
                  suppressRunBoundary={item.suppressRunBoundary}
                  onOpenAgentDestination={onOpenAgentDestination}
                />}
                {renderTailsAfter(itemIndex)}
                {item.message.role === "assistant" && !item.message.streaming && item.message.assistantMessageId
                  ? assistantActions?.(item.message.assistantMessageId) : null}
                {item.message.role === "assistant" && <MessageDecoration sessionId={sessionId} messageId={item.message.uiId} streaming={!!item.message.streaming} />}
                </Fragment>
              );
            })}
            </ExecutionNoticesContext.Provider>
            {reviewResource && onReviewWorkspaceChanges ? (
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
      aria-label={t("workspacePane.filesChanged", {
        count: review.files.length,
      })}
      className="overflow-hidden rounded-lg border border-border/45 bg-muted/[0.16]"
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
          className="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
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
