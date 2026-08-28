import type { ApprovalRecord, ToolProgress } from "@amiba/app-runtime/core";
import { cn } from "../../primitives";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDiff,
  GitBranch,
  Undo2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";
import { useT } from "@amiba/i18n";

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
import { describeToolCall, hasToolDetail } from "./tool-presentation";
import {
  compactWorkspacePath,
  parseWorkspaceReview,
  workspaceReviewResourceFromEvents,
  type WorkspaceReviewResource,
} from "../workspace-review";

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

  if (m.role === "user") {
    const bodyText = stripManagedResourceContext(bubbleTextContent(m.content));
    const fileBadges = m.attachmentBadges ?? [];
    const hasReferences = fileBadges.length > 0;
    const hasContent = bodyText.length > 0;
    return (
      <div
        data-selection="text"
        className="min-w-0 rounded-xl border border-border/60 bg-secondary px-4 py-3 text-sm text-secondary-foreground"
      >
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
          <div className="whitespace-pre-wrap break-words">{bodyText}</div>
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
          <Streamdown
            mode={m.streaming ? "streaming" : "static"}
            parseIncompleteMarkdown
            caret="circle"
            isAnimating={!!m.streaming}
            className="chat-md break-words"
          >
            {trace.bodyText}
          </Streamdown>
        )}
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

type TurnTraceDetail =
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
        mode="static"
        parseIncompleteMarkdown
        className="chat-md chat-md--reasoning break-words px-1.5 text-xs text-muted-foreground/85"
      >
        {text}
      </Streamdown>
    </div>
  );
}

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
  const summaryPresentation = summaryTool
    ? describeToolCall(summaryTool, t)
    : null;
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
    ? [summaryPresentation?.action, summaryPresentation?.target]
        .filter(Boolean)
        .join(" · ")
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
            summaryTool && "font-mono",
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
                    key={detail.id}
                    mode="static"
                    parseIncompleteMarkdown
                    className="chat-md chat-md--reasoning break-words px-1.5 py-1 text-xs text-muted-foreground/85"
                  >
                    {detail.text}
                  </Streamdown>
                );
              }
              return (
                <TraceDisclosure
                  key={detail.id}
                  label={thoughtLabel(t, detail.reasoningMs)}
                  text={detail.text}
                  streaming={false}
                />
              );
            }
            if (detail.kind === "narration") {
              return (
                <Streamdown
                  key={detail.id}
                  mode="static"
                  parseIncompleteMarkdown
                  className="chat-md chat-md--reasoning break-words px-1.5 text-xs text-muted-foreground/85"
                >
                  {detail.text}
                </Streamdown>
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
  const details: TurnTraceDetail[] = [];
  const tools: ToolProgress[] = [];
  const seenToolIds = new Set<string>();
  const seenApprovalIds = new Set<string>();
  let latestProgress = "";
  let liveReasoning = "";

  for (const message of messages) {
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
  | { kind: "text"; id: string; text: string }
  | {
      kind: "execution";
      id: string;
      details: TurnTraceDetail[];
      tools: ToolProgress[];
    };

function buildAssistantFlow(message: UiMessage): AssistantFlowItem[] {
  const timeline = message.assistantTimeline ?? [];
  const tools = new Map(
    (message.toolProgress ?? []).map((event) => [
      event.toolCallId,
      event,
    ]),
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
  const appendText = (id: string, text: string) => {
    const body = splitThinkingFromBody(text).body;
    if (!body.trim()) return;
    flushExecution();
    flow.push({ kind: "text", id, text: body });
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
      appendText(item.id, item.text);
    } else if (item.kind === "tool") {
      appendTool(item.id, item.toolCallId);
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
    appendText(`${message.uiId}:text-tail`, rawBody.slice(timelineText.length));
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
  const flow = buildAssistantFlow(message);
  const trace = resolveAssistantTrace(message);
  const runBoundary = suppressRunBoundary ? null : trace.runBoundary;
  const hasFinalDestination =
    !message.streaming &&
    Boolean(message.agentFinalUrl && onOpenAgentDestination);
  // Two-part turn presentation: everything before the trailing text run is
  // process (narration folded with the tools it accompanied); the trailing
  // run is the result. While streaming, the current text streams in the
  // result slot and is demoted into the fold as soon as another tool call
  // proves it was narration.
  const { head: processSegments, tail: resultSegments } =
    splitTrailingTextRun(flow);
  const processDetails: TurnTraceDetail[] = processSegments.flatMap(
    (segment) =>
      segment.kind === "execution"
        ? segment.details
        : [{ kind: "narration" as const, id: segment.id, text: segment.text }],
  );
  const processTools: ToolProgress[] = processSegments.flatMap((segment) =>
    segment.kind === "execution" ? segment.tools : [],
  );
  const resultText = resultSegments
    .map((segment) => (segment.kind === "text" ? segment.text : ""))
    .join("\n\n")
    .trim();
  const resultStreaming = !!message.streaming;
  const processStreaming = resultStreaming && resultText.length === 0;

  // The thought stream joins the same aggregate as the tools: one collapsed
  // process row whose summary reads "思考了 X 秒 · N 次工具调用", with the
  // full thought text as the first nested detail.
  const clusterDetails: TurnTraceDetail[] =
    trace.reasoningText.length > 0
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
      <div className="flex min-w-0 flex-col gap-2">
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
          <Streamdown
            mode={resultStreaming ? "streaming" : "static"}
            parseIncompleteMarkdown
            caret="circle"
            isAnimating={resultStreaming}
            className="chat-md break-words"
          >
            {resultText}
          </Streamdown>
        )}
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
}: {
  m: UiMessage;
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"];
  userOrdinal: number;
  onBranch?: (message: UiMessage, userOrdinal: number) => void | Promise<void>;
  onRestore?: (message: UiMessage, userOrdinal: number) => void | Promise<void>;
}) {
  const { t } = useT();
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  return (
    <div className="sticky top-0 z-20 -mx-3 bg-background px-3 pb-1">
      <div className="group relative">
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
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse" : "Show full message"}
            aria-label={
              expanded ? "Collapse user message" : "Show full user message"
            }
            className={cn(
              "absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center",
              "rounded-full border border-border/60 bg-background/80 text-muted-foreground",
              "opacity-30 transition-opacity",
              "group-hover:opacity-100 focus-visible:opacity-100",
              "hover:bg-background hover:text-foreground",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden />
            )}
          </button>
        )}
        {(onBranch || onRestore) && !m.streaming ? (
          <div className="absolute bottom-1.5 right-2 flex items-center gap-0.5 rounded-lg border border-border/50 bg-background/90 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                icon={<GitBranch />}
                onClick={() => void onBranch(m, userOrdinal)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
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
  messages,
  onOpenAgentDestination,
  onReviewWorkspaceChanges,
  onBranchUserMessage,
  onRestoreBeforeTurn,
  restorableTurnOrdinals,
}: {
  messages: UiMessage[];
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
  type Turn = {
    user: UiMessage | null;
    replies: UiMessage[];
    userOrdinal: number;
  };
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let userOrdinal = 0;
  for (const m of messages) {
    if (m.role === "user") {
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
        const reviewResource = turn.replies.some((message) => message.streaming)
          ? null
          : workspaceReviewResourceFromEvents(
              turn.replies.flatMap(
                (message) => message.toolProgress ?? [],
              ),
              `turn:${turn.user?.uiId ?? i}`,
            );
        return (
          <div
            key={turn.user?.uiId ?? `turn-${i}`}
            data-conversation-user-turn={turn.user?.uiId}
            className="space-y-2"
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
              />
            )}
            {replyItems.map((item) => {
              if (item.kind === "execution") {
                return (
                  <TurnExecutionDisclosure
                    key={item.id}
                    messages={item.messages}
                  />
                );
              }
              if (item.kind === "boundary") {
                return <RunBoundary key={item.id} state={item.state} />;
              }

              return (
                <Bubble
                  key={item.id}
                  m={item.message}
                  suppressTrace={item.suppressTrace}
                  suppressRunBoundary={item.suppressRunBoundary}
                  onOpenAgentDestination={onOpenAgentDestination}
                />
              );
            })}
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
  const [expanded, setExpanded] = useState(false);
  const review = parseWorkspaceReview(resource.entries);
  const visibleFiles = expanded ? review.files : review.files.slice(0, 3);
  const remaining = Math.max(0, review.files.length - visibleFiles.length);

  return (
    <section
      aria-label={t("workspacePane.filesChanged", {
        count: review.files.length,
      })}
      className="overflow-hidden rounded-xl border border-border/60 bg-background shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <div className="flex min-h-16 items-center gap-3 px-3 py-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/65 text-muted-foreground">
          <FileDiff className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-foreground">
            {t("workspacePane.filesChanged", { count: review.files.length })}
          </span>
          {review.additions > 0 || review.deletions > 0 ? (
            <span className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] tabular-nums">
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
          className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border/70 bg-background px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          {t("workspacePane.review")}
        </button>
      </div>
      <ul className="border-t border-border/45 px-3 py-1.5">
        {visibleFiles.map((file) => (
          <li
            key={file.path}
            className="flex min-h-8 min-w-0 items-center gap-3 text-[11px]"
          >
            <span
              className="min-w-0 flex-1 truncate font-mono text-foreground/72"
              title={file.path}
            >
              {compactWorkspacePath(file.path, 6)}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
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
          </li>
        ))}
        {remaining > 0 || expanded ? (
          <li>
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="inline-flex min-h-8 items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
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
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:h-3 [&_svg]:w-3"
    >
      {icon}
    </button>
  );
}
