import type { HermesToolProgress } from "@amiba/core"
import { useT } from "@amiba/i18n"
import { cn } from "../../primitives"
import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"

import { formatToolDuration } from "../internal/helpers"
import {
  describeToolCall,
  hasToolDetail,
  ToolDetail
} from "./tool-presentation"

/**
 * One quiet execution row. The conversation exposes the semantic action and
 * its target; only calls with useful evidence can be opened.
 */
export function ToolChip({ event }: { event: HermesToolProgress }) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  // Force a re-render every second while running so the duration ticks
  // live. Once `completed` arrives the chip re-renders with `durationMs`
  // and this effect tears down.
  const [tick, setTick] = useState(0)
  const running = event.status === "running"
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])
  void tick

  const presentation = describeToolCall(event, t)
  const ToolIcon = presentation.icon
  const hasDetail = hasToolDetail(event)

  let durationText: string | null = null
  if (!running && typeof event.durationMs === "number") {
    durationText = formatToolDuration(event.durationMs)
  } else if (running && typeof event.startedAt === "number") {
    const elapsed = Date.now() - event.startedAt
    if (elapsed >= 1000) durationText = formatToolDuration(elapsed)
  }

  const detailAction = expanded
    ? t("sidepanel.trace.collapseDetails")
    : t("sidepanel.trace.expandDetails")

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={hasDetail ? expanded : undefined}
        aria-label={[presentation.action, presentation.target].filter(Boolean).join(" ")}
        title={hasDetail ? detailAction : presentation.action}
        className={cn(
          "group/tool inline-flex min-h-7 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-[11px] text-muted-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          hasDetail
            ? "cursor-pointer hover:bg-muted/45 hover:text-foreground"
            : "cursor-default",
          running && "text-foreground/75"
        )}>
        <span
          aria-hidden
          className="inline-flex h-3 w-3 shrink-0 items-center justify-center leading-none">
          {running ? (
            <span className="hermes-thinking-dot" />
          ) : (
            <ToolIcon
              className={cn(
                "h-3 w-3",
                event.error ? "text-destructive/80" : "opacity-55"
              )}
            />
          )}
        </span>
        <span className="shrink-0 text-foreground/75">{presentation.action}</span>
        {presentation.target && (
          <span className="min-w-0 truncate font-mono text-foreground/65">
            {presentation.target}
          </span>
        )}
        {durationText && (
          <span className="shrink-0 tabular-nums text-muted-foreground/65">
            {durationText}
          </span>
        )}
        {hasDetail && (
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3 w-3 shrink-0 opacity-45 transition-transform group-hover/tool:opacity-70",
              expanded && "rotate-90"
            )}
          />
        )}
      </button>
      {expanded && hasDetail && (
        <div className="ml-[7px] border-l border-border/60 pb-1.5 pl-4 pr-1">
          <ToolDetail event={event} t={t} />
        </div>
      )}
    </div>
  )
}

/** Legacy stack-of-chips renderer used for old messages without a timeline. */
export function ToolProgressChips({ events }: { events: HermesToolProgress[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {events.map((ev) => (
        <ToolChip key={ev.toolCallId} event={ev} />
      ))}
    </div>
  )
}
