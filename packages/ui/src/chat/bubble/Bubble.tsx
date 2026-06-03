import { cn } from "../../primitives"
import { ChevronDown, ChevronUp, Globe } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"

import {
  bubbleTextContent,
  hostnameOf,
  splitThinkingFromBody
} from "../internal/helpers"
import {
  CAPPED_HEIGHT_CLASS,
  CAPPED_HEIGHT_PX,
  EXPANDED_MAX_HEIGHT_CLASS,
  type UiMessage
} from "../internal/types"
import { ApprovalRecordChip, ApprovalRecordList } from "./approval"
import {
  AgentDestinationChip,
  AttachmentBadgeView
} from "./chips"
import { ToolChip, ToolProgressChips } from "./tool-chip"

export interface BubbleProps {
  m: UiMessage
  showStreamDetails?: boolean
  /**
   * Called when the "Open in my browser →" chip on a finished assistant
   * bubble is clicked. Extension impl opens in a chrome tab; desktop impl
   * defers to `shell.openExternal`.
   */
  onOpenAgentDestination?: (url: string) => void | Promise<void>
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
export function Bubble({ m, showStreamDetails = false, onOpenAgentDestination }: BubbleProps) {
  if (m.role === "user") {
    const bodyText = bubbleTextContent(m.content)
    const pageBadges =
      m.pageBadges && m.pageBadges.length > 0
        ? m.pageBadges
        : m.pageBadge
          ? [m.pageBadge]
          : []
    const fileBadges = m.attachmentBadges ?? []
    const hasReferences = pageBadges.length > 0 || fileBadges.length > 0
    const hasContent = bodyText.length > 0
    return (
      <div className="min-w-0 rounded-xl border border-border/60 bg-secondary px-4 py-3 text-sm text-secondary-foreground">
        {hasReferences && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-1.5",
              hasContent && "mb-2"
            )}>
            {fileBadges.map((b) => (
              <AttachmentBadgeView key={b.uiId} badge={b} />
            ))}
            {pageBadges.map((b, i) => (
              <div
                key={`page-${b.url}-${i}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
                title={b.url}>
                <Globe className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{b.title || hostnameOf(b.url) || b.url}</span>
              </div>
            ))}
          </div>
        )}
        {hasContent && (
          <div className="whitespace-pre-wrap break-words">{bodyText}</div>
        )}
      </div>
    )
  }

  if (m.role === "assistant") {
    const rawBody = bubbleTextContent(m.content)
    const { body: bodyText, thinking: extractedThinking } = splitThinkingFromBody(rawBody)
    const verboseText = bubbleTextContent(m.streamVerbose)
    const reasoningText = [bubbleTextContent(m.reasoning).trim(), extractedThinking]
      .filter((s) => s.length > 0)
      .join("\n\n")
    const toolProgress = m.hermesToolProgress ?? []
    const timeline = m.assistantTimeline ?? []
    const hasTimeline = showStreamDetails && timeline.length > 0
    const hasReasoningBlock = showStreamDetails && verboseText.trim().length > 0
    const hasLegacyToolList = showStreamDetails && !hasTimeline && toolProgress.length > 0
    const hasVerboseBlock = hasReasoningBlock || hasLegacyToolList || hasTimeline

    // Bubble has no user-visible content for the current view → skip it.
    // Reasoning text only counts when `showStreamDetails` is on; with the
    // thinking trace hidden, a reasoning-only bubble would otherwise paint
    // an empty `px-1 py-1` strip and many of them stack into the large
    // blank band reported between turns.
    const reasoningVisible = showStreamDetails && reasoningText.length > 0
    if (
      !m.streaming &&
      bodyText.trim().length === 0 &&
      !reasoningVisible &&
      !hasVerboseBlock
    ) {
      return null
    }

    // Pre-token streaming placeholder — only when we genuinely have
    // nothing visible yet. If reasoning is already streaming (and the
    // user kept the trace visible) or a tool timeline / progress block
    // has started, we'd rather paint the real content than mask it with
    // a generic "Thinking…" line.
    const hasVisibleContent =
      bodyText.trim().length > 0 ||
      (showStreamDetails && reasoningText.length > 0) ||
      hasVerboseBlock
    const isEmptyStreaming = !!m.streaming && !hasVisibleContent
    if (isEmptyStreaming) {
      const runningTool = toolProgress.find((e) => e.status === "running")
      const hasFinishedTool = toolProgress.some((e) => e.status === "completed")
      const placeholder = runningTool
        ? `Running ${runningTool.tool}…`
        : hasFinishedTool
          ? "Generating answer…"
          : "Thinking…"
      return (
        <div className="px-1 py-1 text-sm" aria-live="polite">
          <div className="inline-flex max-w-full items-center gap-2 text-muted-foreground">
            <span className="hermes-thinking-dot shrink-0" aria-hidden="true" />
            <span className="truncate">{placeholder}</span>
          </div>
        </div>
      )
    }

    const hasRunningTool = toolProgress.some((e) => e.status === "running")
    const awaitingAnswerOnly =
      !!m.streaming &&
      bodyText.trim() === "" &&
      hasVerboseBlock &&
      !hasRunningTool &&
      !hasTimeline
    const progressMap = new Map(toolProgress.map((p) => [p.toolCallId, p] as const))
    const approvalRecords = m.hermesApprovalRecords ?? []
    const approvalMap = new Map(approvalRecords.map((r) => [r.approvalId, r] as const))

    return (
      <div className="min-w-0 px-1 py-1 text-sm">
        {reasoningText.length > 0 && showStreamDetails && (
          <Streamdown
            mode={m.streaming ? "streaming" : "static"}
            parseIncompleteMarkdown
            caret="circle"
            isAnimating={!!m.streaming}
            className="chat-md chat-md--reasoning mb-1.5 break-words">
            {reasoningText}
          </Streamdown>
        )}
        {hasReasoningBlock && (
          <Streamdown
            mode={m.streaming ? "streaming" : "static"}
            parseIncompleteMarkdown
            caret="circle"
            isAnimating={!!m.streaming}
            className="chat-md mb-2 break-words text-xs text-muted-foreground/80">
            {verboseText}
          </Streamdown>
        )}
        {hasLegacyToolList && (
          <div className="mb-2">
            <ToolProgressChips events={toolProgress} />
            {awaitingAnswerOnly && (
              <div className="mt-1.5 inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="hermes-thinking-dot" aria-hidden="true" />
                <span>Generating answer…</span>
              </div>
            )}
          </div>
        )}
        {hasTimeline ? (
          (() => {
            let lastTextId: string | null = null
            for (let i = timeline.length - 1; i >= 0; i--) {
              const it = timeline[i]
              if (it.kind === "text") {
                lastTextId = it.id
                break
              }
            }
            return (
              <div className="flex flex-col gap-2">
                {timeline.map((item) => {
                  if (item.kind === "text") {
                    if (!item.text.trim()) return null
                    const isLive = !!m.streaming && item.id === lastTextId
                    return (
                      <Streamdown
                        key={item.id}
                        mode={isLive ? "streaming" : "static"}
                        parseIncompleteMarkdown
                        caret="circle"
                        isAnimating={isLive}
                        className="chat-md break-words">
                        {item.text}
                      </Streamdown>
                    )
                  }
                  if (item.kind === "tool") {
                    const ev = progressMap.get(item.toolCallId)
                    if (!ev) return null
                    return <ToolChip key={item.id} event={ev} />
                  }
                  const rec = approvalMap.get(item.approvalId)
                  if (!rec) return null
                  return <ApprovalRecordChip key={item.id} record={rec} />
                })}
              </div>
            )
          })()
        ) : (
          bodyText.trim().length > 0 && (
            <Streamdown
              mode="streaming"
              parseIncompleteMarkdown
              caret="circle"
              isAnimating={!!m.streaming}
              className="chat-md break-words">
              {bodyText}
            </Streamdown>
          )
        )}
        {!hasTimeline &&
          m.hermesApprovalRecords &&
          m.hermesApprovalRecords.length > 0 && (
            <ApprovalRecordList records={m.hermesApprovalRecords} />
          )}
        {!m.streaming && m.agentFinalUrl && onOpenAgentDestination && (
          <AgentDestinationChip
            url={m.agentFinalUrl}
            title={m.agentFinalTitle}
            onOpen={onOpenAgentDestination}
          />
        )}
      </div>
    )
  }

  return (
    <div className="mx-3 rounded-md bg-muted/50 p-2 font-mono text-xs">
      [{m.role}] {bubbleTextContent(m.content)}
    </div>
  )
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
  onOpenAgentDestination
}: {
  m: UiMessage
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"]
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [overflowed, setOverflowed] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const measure = () => {
      setOverflowed(inner.scrollHeight > CAPPED_HEIGHT_PX + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!overflowed && expanded) setExpanded(false)
  }, [overflowed, expanded])

  const isClipping = overflowed && !expanded

  return (
    <div className="sticky top-0 z-20 -mx-3 bg-background px-3 pb-1">
      <div className="group relative">
        <div
          className={cn(
            "rounded-xl",
            expanded
              ? `${EXPANDED_MAX_HEIGHT_CLASS} overflow-y-auto`
              : `${CAPPED_HEIGHT_CLASS} overflow-hidden`
          )}>
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
            aria-label={expanded ? "Collapse user message" : "Show full user message"}
            className={cn(
              "absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center",
              "rounded-full border border-border/60 bg-background/80 text-muted-foreground",
              "opacity-30 transition-opacity",
              "group-hover:opacity-100 focus-visible:opacity-100",
              "hover:bg-background hover:text-foreground",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}>
            {expanded ? (
              <ChevronUp className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden />
            )}
          </button>
        )}
      </div>
    </div>
  )
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
  showStreamDetails,
  onOpenAgentDestination
}: {
  messages: UiMessage[]
  showStreamDetails: boolean
  onOpenAgentDestination?: BubbleProps["onOpenAgentDestination"]
}) {
  type Turn = { user: UiMessage | null; replies: UiMessage[] }
  const turns: Turn[] = []
  let cur: Turn | null = null
  for (const m of messages) {
    if (m.role === "user") {
      cur = { user: m, replies: [] }
      turns.push(cur)
    } else if (cur) {
      cur.replies.push(m)
    } else {
      cur = { user: null, replies: [m] }
      turns.push(cur)
    }
  }
  return (
    <>
      {turns.map((turn, i) => (
        <div key={turn.user?.uiId ?? `turn-${i}`} className="space-y-2">
          {turn.user && (
            <UserStickyBubble m={turn.user} onOpenAgentDestination={onOpenAgentDestination} />
          )}
          {turn.replies.map((m) => (
            <Bubble
              key={m.uiId}
              m={m}
              showStreamDetails={showStreamDetails}
              onOpenAgentDestination={onOpenAgentDestination}
            />
          ))}
        </div>
      ))}
    </>
  )
}
