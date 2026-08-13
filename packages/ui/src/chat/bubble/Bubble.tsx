import type { ApprovalRecord, HermesToolProgress } from "@amiba/core";
import { cn } from "../../primitives";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { useT } from "@amiba/i18n";

import {
  bubbleTextContent,
  hostnameOf,
  stripManagedResourceContext,
  splitThinkingFromBody,
  splitWorkspaceFromBody,
} from "../internal/helpers";
import {
  CAPPED_HEIGHT_CLASS,
  CAPPED_HEIGHT_PX,
  EXPANDED_MAX_HEIGHT_CLASS,
  type UiMessage,
} from "../internal/types";
import { ApprovalRecordChip } from "./approval";
import { AgentDestinationChip, AttachmentBadgeView } from "./chips";
import { ToolChip } from "./tool-chip";
import { describeToolCall, hasToolDetail } from "./tool-presentation";

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
    // Workspace remains session-level execution context and sidebar grouping.
    // Strip its internal prompt block from persisted messages, but don't echo
    // the same immutable directory on every user bubble.
    const { body: expandedBodyText } = splitWorkspaceFromBody(
      bubbleTextContent(m.content),
    );
    const bodyText = stripManagedResourceContext(expandedBodyText);
    const pageBadges =
      m.pageBadges && m.pageBadges.length > 0
        ? m.pageBadges
        : m.pageBadge
          ? [m.pageBadge]
          : [];
    const fileBadges = m.attachmentBadges ?? [];
    const hasReferences = pageBadges.length > 0 || fileBadges.length > 0;
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
            {pageBadges.map((b, i) => (
              <div
                key={`page-${b.url}-${i}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
                title={b.url}
              >
                <Globe className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">
                  {b.title || hostnameOf(b.url) || b.url}
                </span>
              </div>
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

    // A completed assistant message with no answer or inspectable execution
    // record should take up no space in the conversation.
    if (
      !m.streaming &&
      !hasBody &&
      !traceVisible &&
      !runBoundary &&
      !hasFinalDestination
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
    const hasVisibleContent = hasBody || traceVisible || hasFinalDestination;
    const isEmptyStreaming = !!m.streaming && !hasVisibleContent;
    if (isEmptyStreaming) {
      return (
        <div className="px-1 py-1 text-sm" aria-live="polite">
          <div className="inline-flex max-w-full items-center text-muted-foreground">
            <span className="hermes-thinking-text truncate">
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
        {traceVisible && (
          <div className={cn("flex flex-col gap-0.5", hasBody ? "mb-2" : "")}>
            {m.streaming && trace.reasoningText.length > 0 && (
              <div className="inline-flex min-h-7 max-w-full items-center px-1.5 text-[11px] text-muted-foreground">
                <span className="hermes-thinking-text truncate">
                  {compactProgressNote(trace.reasoningText)}
                </span>
              </div>
            )}
            {trace.legacyToolDetails.length > 0 && (
              <TraceDisclosure
                label={t("sidepanel.trace.toolDetails")}
                text={trace.legacyToolDetails}
                streaming={!!m.streaming}
              />
            )}
            {trace.items.map((item) => {
              if (item.kind === "tool") {
                return <ToolChip key={item.id} event={item.event} />;
              }
              return <ApprovalRecordChip key={item.id} record={item.record} />;
            })}
            {awaitingAnswerOnly && (
              <div
                className="inline-flex min-h-7 items-center px-1.5 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                <span className="hermes-thinking-text">
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
  | { kind: "tool"; id: string; event: HermesToolProgress }
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
  const toolProgress = m.hermesToolProgress ?? [];
  const approvalRecords = m.hermesApprovalRecords ?? [];
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
  const legacyToolDetails =
    verboseText.trim().length > 0 && !hasPerToolDetails
      ? verboseText.trim()
      : "";

  return {
    bodyText,
    runBoundary: terminal.state,
    reasoningText,
    legacyToolDetails,
    toolProgress,
    items,
    hasRunningTool: toolProgress.some((event) => event.status === "running"),
    hasTrace:
      (!!m.streaming && reasoningText.length > 0) ||
      legacyToolDetails.length > 0 ||
      items.length > 0,
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

function TraceDisclosure({
  label,
  text,
  streaming,
}: {
  label: string;
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
        className="group/trace inline-flex min-h-7 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span
          aria-hidden
          className="inline-flex h-3 w-3 shrink-0 items-center justify-center"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-45" />
        </span>
        <span className="min-w-0 truncate">{label}</span>
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
      kind: "legacy";
      id: string;
      text: string;
      streaming: boolean;
    }
  | {
      kind: "tool";
      id: string;
      event: HermesToolProgress;
    }
  | {
      kind: "approval";
      id: string;
      record: ApprovalRecord;
    };

/**
 * One compact disclosure for a consecutive execution segment.
 */
function ExecutionDisclosure({
  details,
  tools,
  streaming,
  latestProgress = "",
}: {
  details: TurnTraceDetail[];
  tools: HermesToolProgress[];
  streaming: boolean;
  latestProgress?: string;
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
  const summaryLabel = summaryTool
    ? [summaryPresentation?.action, summaryPresentation?.target]
        .filter(Boolean)
        .join(" · ")
    : streaming
      ? latestProgress || t("sidepanel.trace.thinking")
      : tools.length > 0
        ? t("sidepanel.trace.toolCount", { count: tools.length })
        : latestProgress || t("sidepanel.trace.executionDetails");

  return (
    <div className="min-w-0 px-1 py-0.5 text-sm" data-execution-summary>
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
            "min-w-0 truncate text-muted-foreground/75",
            streaming && "hermes-thinking-text",
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
      {expanded && hasDetails && (
        <div className="ml-[7px] flex min-w-0 flex-col gap-0.5 border-l border-border/60 py-1.5 pl-3 pr-1">
          {details.map((detail) => {
            if (detail.kind === "legacy") {
              return (
                <TraceDisclosure
                  key={detail.id}
                  label={t("sidepanel.trace.toolDetails")}
                  text={detail.text}
                  streaming={detail.streaming}
                />
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

/** Collapses one or more adjacent legacy execution-only messages. */
function TurnExecutionDisclosure({ messages }: { messages: UiMessage[] }) {
  const details: TurnTraceDetail[] = [];
  const tools: HermesToolProgress[] = [];
  const seenToolIds = new Set<string>();
  const seenApprovalIds = new Set<string>();
  let latestProgress = "";

  for (const message of messages) {
    const trace = resolveAssistantTrace(message);
    if (message.streaming && trace.reasoningText) {
      latestProgress = compactProgressNote(trace.reasoningText);
    }
    if (trace.legacyToolDetails) {
      details.push({
        kind: "legacy",
        id: `${message.uiId}:legacy`,
        text: trace.legacyToolDetails,
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
    <ExecutionDisclosure
      details={details}
      tools={tools}
      streaming={messages.some((message) => message.streaming)}
      latestProgress={latestProgress}
    />
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
 * Historical Hermes rows do not contain `assistantTimeline`. Preserve their
 * row order instead of lifting every tool call to the start of the user turn:
 *
 *   assistant text → every following tool → next assistant text
 *
 * Hermes may persist the first tool on the same assistant row as the prose,
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
      hasBody || Boolean(message.agentFinalUrl) || Boolean(message.streaming);

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
      tools: HermesToolProgress[];
    };

function buildAssistantFlow(message: UiMessage): AssistantFlowItem[] {
  const timeline = message.assistantTimeline ?? [];
  const tools = new Map(
    (message.hermesToolProgress ?? []).map((event) => [
      event.toolCallId,
      event,
    ]),
  );
  const approvals = new Map(
    (message.hermesApprovalRecords ?? []).map((record) => [
      record.approvalId,
      record,
    ]),
  );
  const seenTools = new Set<string>();
  const seenApprovals = new Set<string>();
  const flow: AssistantFlowItem[] = [];
  let pendingDetails: TurnTraceDetail[] = [];
  let pendingTools: HermesToolProgress[] = [];

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

  for (const event of message.hermesToolProgress ?? []) {
    appendTool(`tool:${event.toolCallId}`, event.toolCallId);
  }
  for (const record of message.hermesApprovalRecords ?? []) {
    appendApproval(`approval:${record.approvalId}`, record.approvalId);
  }

  const trace = resolveAssistantTrace(message);
  if (trace.legacyToolDetails) {
    pendingDetails.push({
      kind: "legacy",
      id: `${message.uiId}:legacy`,
      text: trace.legacyToolDetails,
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
  return (
    <div data-selection="text" className="min-w-0 px-1 py-1 text-sm">
      <div className="flex min-w-0 flex-col gap-2">
        {flow.map((item, index) => {
          const active = !!message.streaming && index === flow.length - 1;
          if (item.kind === "execution") {
            return (
              <ExecutionDisclosure
                key={item.id}
                details={item.details}
                tools={item.tools}
                streaming={active}
              />
            );
          }
          return (
            <Streamdown
              key={item.id}
              mode={active ? "streaming" : "static"}
              parseIncompleteMarkdown
              caret="circle"
              isAnimating={active}
              className="chat-md break-words"
            >
              {item.text}
            </Streamdown>
          );
        })}
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
}: {
  m: UiMessage;
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"];
}) {
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
}: {
  messages: UiMessage[];
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"];
}) {
  type Turn = { user: UiMessage | null; replies: UiMessage[] };
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      cur = { user: m, replies: [] };
      turns.push(cur);
    } else if (cur) {
      cur.replies.push(m);
    } else {
      cur = { user: null, replies: [m] };
      turns.push(cur);
    }
  }

  return (
    <>
      {turns.map((turn, i) => {
        const replyItems = buildTurnReplyItems(turn.replies);
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
          </div>
        );
      })}
    </>
  );
}
