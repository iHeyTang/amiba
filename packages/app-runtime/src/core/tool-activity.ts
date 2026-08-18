/**
 * Tool-activity ledger — shared wire types + pure aggregation helpers.
 *
 * The runtime usage projection records aggregate token counts but not a
 * host-local per-tool-call ledger, so the desktop process captures
 * `tool.started` / `tool.completed` events into per-day buckets
 * on disk (see `apps/desktop/src/main/tool-activity.ts`) and the Usage
 * page reads them back over IPC. Both sides share these types; the
 * aggregation helpers are pure so the renderer can crunch raw rows
 * client-side.
 *
 * History from before capture began is unavoidably missing; the UI
 * surfaces this implicitly by showing data from "Today" onward.
 */

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
   *  before the agent finished). */
  durationMs?: number
  /** True iff a matching `tool.completed` was observed. */
  completed: boolean
}

export interface ToolActivityTotals {
  calls: number
  /** Distinct tool names contributing to the bucket. */
  distinctTools: number
  /** Wall-clock runtime in ms, summed across completed calls only. */
  totalDurationMs: number
  /** Calls that never reported completion — implies the turn was
   *  cancelled or the agent crashed mid-call. */
  unfinished: number
}

export interface ToolActivityDayBucket extends ToolActivityTotals {
  day: string
}

/** Raw rows for one local-tz day, as returned by the desktop IPC read. */
export interface ToolActivityDayRows {
  day: string
  rows: ToolInvocation[]
}

/** Payload of the desktop `tool-activity:read` IPC call. */
export interface ToolActivityReadResult {
  /** Most recent day first; exactly the requested number of days. */
  days: ToolActivityDayRows[]
  lifetime: ToolActivityTotals
}

/**
 * Reader the Tools page consumes. Desktop injects an implementation
 * backed by `window.amiba.toolActivity.read`; other hosts leave it
 * undefined and the tab renders its empty state.
 */
export type ToolActivityReader = (days: number) => Promise<ToolActivityReadResult>

/**
 * Full data source for the Tools page's Activity tab. `read` pulls the
 * ledger; `onChanged` (when the host provides push — desktop does, via
 * the main-process recorder's broadcast) notifies on every ledger write
 * so the UI can refetch immediately instead of polling.
 */
export interface ToolActivitySource {
  read: ToolActivityReader
  /** Subscribe to ledger changes; returns an unsubscribe function. */
  onChanged?: (cb: () => void) => () => void
}

/** Local-tz day key (YYYY-MM-DD) so "today" matches the calendar. */
export function toolActivityDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function emptyToolActivityTotals(): ToolActivityTotals {
  return {
    calls: 0,
    distinctTools: 0,
    totalDurationMs: 0,
    unfinished: 0,
  }
}

export function emptyToolActivityDay(day: string): ToolActivityDayBucket {
  return { day, ...emptyToolActivityTotals() }
}

/**
 * Aggregate a set of invocations into a single totals record.
 * Distinct-tool count uses a Set — cheap for the volumes we see.
 */
export function aggregateToolActivity(
  rows: Iterable<ToolInvocation>,
): ToolActivityTotals & { tools: Set<string> } {
  const tools = new Set<string>()
  let calls = 0
  let totalDurationMs = 0
  let unfinished = 0
  for (const r of rows) {
    calls++
    tools.add(r.tool)
    if (r.completed && typeof r.durationMs === "number") {
      totalDurationMs += r.durationMs
    } else if (!r.completed) {
      unfinished++
    }
  }
  return {
    tools,
    calls,
    distinctTools: tools.size,
    totalDurationMs,
    unfinished,
  }
}

export function aggregateToolActivityToBucket(
  rows: Iterable<ToolInvocation>,
  day: string,
): ToolActivityDayBucket {
  const a = aggregateToolActivity(rows)
  return {
    day,
    calls: a.calls,
    distinctTools: a.distinctTools,
    totalDurationMs: a.totalDurationMs,
    unfinished: a.unfinished,
  }
}
