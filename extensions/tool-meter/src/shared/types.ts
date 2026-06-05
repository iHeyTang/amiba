/**
 * Wire types between the tool-meter main runner and its UI panel.
 *
 * Unlike token-meter, hermes-agent doesn't persist a per-tool-call
 * ledger we can query back — the only source is the live
 * `host.chat.onEvent` stream. So the runner stores invocations into
 * `host.storage` itself, bucketed by day for cheap range queries.
 *
 * History before the extension was installed is therefore
 * unavoidably missing; the UI surfaces this implicitly by showing
 * data from "Today" onward.
 */

import type { HeatmapCellBase } from "@hermes-x/ui"

export interface ToolInvocation {
  /** ms epoch when the tool started (matches tool.started.startedAt). */
  ts: number
  sessionId?: string
  runId?: string
  /** Tool name, e.g. "search", "shell". */
  tool: string
  /** Provider-side correlation id linking start and completion. */
  toolCallId: string
  /** Wall-clock runtime in ms, when known. Absent for invocations
   *  whose completion event never arrived (e.g. session cancelled
   *  before agent finished). */
  durationMs?: number
  /** True iff a matching `tool.completed` was observed. */
  completed: boolean
}

export interface BucketTotals {
  calls: number
  /** Distinct tool names contributing to the bucket. */
  distinctTools: number
  /** Wall-clock runtime in ms, summed across calls; only includes
   *  invocations that completed (we don't know how long a pending
   *  call ran). */
  totalDurationMs: number
  /** Calls that never reported completion — implies the turn was
   *  cancelled or the agent crashed mid-call. */
  unfinished: number
}

export interface DayBucket extends BucketTotals {
  day: string
}

export interface ToolTotals extends BucketTotals {
  tool: string
}

export interface ToolPerDay {
  tool: string
  perDay: DayBucket[]
}

export interface MeterSummary {
  generatedAt: number
  today: DayBucket
  /** Newest day first. */
  last7Days: DayBucket[]
  /** Per-tool breakdown over the same 7-day window. UI sums the
   *  first N entries when the user picks a shorter range. */
  byToolLast7: ToolPerDay[]
  lifetime: BucketTotals
}

export interface HeatmapToolShare {
  tool: string
  calls: number
}

/**
 * Heatmap cell. `value` is the day's total call count so the shared
 * @hermes-x/ui Heatmap can render it. `toolBreakdown` powers the
 * hover popover's per-tool detail rows.
 */
export interface HeatmapCell extends HeatmapCellBase {
  toolBreakdown: HeatmapToolShare[]
}
