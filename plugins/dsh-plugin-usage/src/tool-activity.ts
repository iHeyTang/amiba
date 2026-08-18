/**
 * Tool-activity ledger — wire types + pure aggregation helpers.
 *
 * Owned by this plugin (moved here from `@amiba/app-runtime/core` in the
 * T9 pluginization surgery): the platform contract carries no shape types
 * for domain concepts, only mechanisms. The runtime half
 * (`tool-activity-recorder.ts`) captures `tool/call` / `tool/result`
 * session events into per-day JSON buckets on disk; the client half
 * (`client/tool-usage.ts`) crunches the raw rows it reads back over the
 * plugin's Typert Remote. Both sides share these types; the aggregation
 * helpers are pure so the client can run them in the browser.
 *
 * History from before capture began is unavoidably missing; the UI
 * surfaces this implicitly by showing data from "Today" onward.
 */

export interface ToolInvocation {
  /** ms epoch when the tool started (the `tool/call` event's time). */
  ts: number;
  sessionId?: string;
  runId?: string;
  /** Tool name, e.g. "search", "shell". */
  tool: string;
  /** Provider-side correlation id linking start and completion. */
  toolCallId: string;
  /** Wall-clock runtime in ms, when known. Absent for invocations
   *  whose completion event never arrived (e.g. session cancelled
   *  before the agent finished). */
  durationMs?: number;
  /** True iff a matching `tool/result` was observed. */
  completed: boolean;
}

export interface ToolActivityTotals {
  calls: number;
  /** Distinct tool names contributing to the bucket. */
  distinctTools: number;
  /** Wall-clock runtime in ms, summed across completed calls only. */
  totalDurationMs: number;
  /** Calls that never reported completion — implies the turn was
   *  cancelled or the agent crashed mid-call. */
  unfinished: number;
}

export interface ToolActivityDayBucket extends ToolActivityTotals {
  day: string;
}

/** Raw rows for one local-tz day, as returned by the remote read. */
export interface ToolActivityDayRows {
  day: string;
  rows: ToolInvocation[];
}

/** Payload of the plugin's `amibaUsage/readToolActivity` Remote call. */
export interface ToolActivityReadResult {
  /** Most recent day first; exactly the requested number of days. */
  days: ToolActivityDayRows[];
  lifetime: ToolActivityTotals;
}

/** Local-tz day key (YYYY-MM-DD) so "today" matches the calendar. */
export function toolActivityDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyToolActivityTotals(): ToolActivityTotals {
  return {
    calls: 0,
    distinctTools: 0,
    totalDurationMs: 0,
    unfinished: 0,
  };
}

export function emptyToolActivityDay(day: string): ToolActivityDayBucket {
  return { day, ...emptyToolActivityTotals() };
}

/**
 * Aggregate a set of invocations into a single totals record.
 * Distinct-tool count uses a Set — cheap for the volumes we see.
 */
export function aggregateToolActivity(
  rows: Iterable<ToolInvocation>,
): ToolActivityTotals & { tools: Set<string> } {
  const tools = new Set<string>();
  let calls = 0;
  let totalDurationMs = 0;
  let unfinished = 0;
  for (const r of rows) {
    calls++;
    tools.add(r.tool);
    if (r.completed && typeof r.durationMs === "number") {
      totalDurationMs += r.durationMs;
    } else if (!r.completed) {
      unfinished++;
    }
  }
  return {
    tools,
    calls,
    distinctTools: tools.size,
    totalDurationMs,
    unfinished,
  };
}

export function aggregateToolActivityToBucket(
  rows: Iterable<ToolInvocation>,
  day: string,
): ToolActivityDayBucket {
  const a = aggregateToolActivity(rows);
  return {
    day,
    calls: a.calls,
    distinctTools: a.distinctTools,
    totalDurationMs: a.totalDurationMs,
    unfinished: a.unfinished,
  };
}
