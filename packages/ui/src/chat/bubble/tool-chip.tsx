import type { HermesToolProgress } from "@amiba/core"
import { cn } from "../../primitives"
import { useEffect, useState } from "react"

import { formatToolDuration } from "../internal/helpers"

/**
 * One tool-progress chip. Layout: [status slot][tool name][· label preview]
 * [duration].
 *
 * The status slot is a fixed width so the chip text aligns regardless of
 * whether the leading glyph is an animated dot (running), an emoji
 * (completed with emoji), or a solid placeholder dot (completed without
 * emoji). Click toggles a details panel for the full `label` text.
 */
export function ToolChip({ event }: { event: HermesToolProgress }) {
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

  const labelRaw = (event.label ?? "").trim()
  const labelMeaningful = labelRaw && labelRaw !== event.tool
  const hasDetail = !!labelMeaningful

  let durationText: string | null = null
  if (!running && typeof event.durationMs === "number") {
    durationText = formatToolDuration(event.durationMs)
  } else if (running && typeof event.startedAt === "number") {
    const elapsed = Date.now() - event.startedAt
    if (elapsed >= 1000) durationText = formatToolDuration(elapsed)
  }

  const tooltipParts: string[] = [event.tool]
  if (labelMeaningful) tooltipParts.push(labelRaw)
  if (running) {
    tooltipParts.push("running…")
  } else if (typeof event.durationMs === "number") {
    tooltipParts.push(`completed in ${formatToolDuration(event.durationMs)}`)
  }
  if (hasDetail) tooltipParts.push("(click to expand)")
  const tooltip = tooltipParts.join(" · ")

  return (
    <div className="flex max-w-full flex-col items-start gap-1">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        title={tooltip}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] leading-none transition-colors",
          running
            ? "border-amber-400/60 bg-amber-50/70 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            : hasDetail
              ? expanded
                ? "border-border bg-muted text-foreground"
                : "cursor-pointer border-border/60 bg-muted/30 text-foreground/75 hover:bg-muted/60"
              : "cursor-default border-border/40 bg-muted/20 text-foreground/55"
        )}>
        {/* Fixed-width status slot — keeps tool-name column aligned across
            running / completed-with-emoji / completed-plain chips. */}
        <span
          aria-hidden
          className="inline-flex h-3 w-3 shrink-0 items-center justify-center leading-none">
          {running ? (
            <span className="hermes-thinking-dot" />
          ) : event.emoji ? (
            <span className="leading-none">{event.emoji}</span>
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
          )}
        </span>
        <span className="shrink-0">{event.tool}</span>
        {labelMeaningful && (
          <>
            <span aria-hidden className="shrink-0 opacity-40">
              ·
            </span>
            <span className="min-w-0 truncate font-mono text-foreground/60">{labelRaw}</span>
          </>
        )}
        {durationText && (
          <span
            className={cn(
              "ml-auto shrink-0 pl-1 tabular-nums opacity-70",
              running ? "" : "text-foreground/55"
            )}>
            {durationText}
          </span>
        )}
      </button>
      {expanded && hasDetail && (
        <div className="w-full rounded-md border border-border/50 bg-muted/25 px-2 py-1.5">
          <pre className="whitespace-pre-wrap break-all font-mono text-[10.5px] leading-snug text-muted-foreground">
            {event.label}
          </pre>
        </div>
      )}
    </div>
  )
}

/** Legacy stack-of-chips renderer used for old messages without a timeline. */
export function ToolProgressChips({ events }: { events: HermesToolProgress[] }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {events.map((ev) => (
        <ToolChip key={ev.toolCallId} event={ev} />
      ))}
    </div>
  )
}
