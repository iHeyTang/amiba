/**
 * Per-day buckets of ToolInvocation records persisted to host.storage.
 *
 *   meter.day.YYYY-MM-DD   → ToolInvocation[]
 *   meter.lifetime         → BucketTotals (running aggregate)
 *
 * Same shape as the token-meter precursor: day keys are local-tz so
 * "today" matches what a human reads off a calendar.
 *
 * Why we persist locally (vs read from hermes-agent like token-meter):
 * hermes-agent's session table records aggregate token counts but not
 * a per-tool-call ledger, and the messages-table walk would be N+1.
 * Live capture via host.chat.onEvent is the path that scales.
 */

import type { MainHost } from "@hermes-x/extension-api"

import type { BucketTotals, DayBucket, ToolInvocation } from "../shared/types"

const KEY_DAY_PREFIX = "meter.day."
const KEY_LIFETIME = "meter.summary.lifetime"

export function dayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function emptyTotals(): BucketTotals {
  return {
    calls: 0,
    distinctTools: 0,
    totalDurationMs: 0,
    unfinished: 0,
  }
}

function emptyDay(day: string): DayBucket {
  return { day, ...emptyTotals() }
}

/**
 * Append a new invocation to today's bucket. Called from the
 * tool.started handler — we save first, then patch on completion via
 * markCompleted so the recent-calls list shows the call immediately
 * even while it's still running.
 */
export async function appendInvocation(
  host: MainHost,
  inv: ToolInvocation,
): Promise<void> {
  const key = KEY_DAY_PREFIX + dayKey(inv.ts)
  const existing = await host.storage.get<ToolInvocation[]>(key, [])
  const next = Array.isArray(existing) ? [...existing, inv] : [inv]
  await host.storage.set(key, next)
  await bumpLifetime(host, +1, 0, 0, +1) // call, no duration yet, unfinished+1
}

/**
 * Mark an existing invocation as completed and stamp its duration.
 * We walk recent days because a tool can technically span midnight;
 * 99% of the time it's on today's bucket so the search cost is tiny.
 */
export async function markCompleted(
  host: MainHost,
  toolCallId: string,
  durationMs: number | undefined,
): Promise<void> {
  // Walk up to 7 days back — anything longer than that and the cost
  // of failing-to-mark a stale call is negligible.
  for (let i = 0; i < 7; i++) {
    const ts = Date.now() - i * 24 * 60 * 60 * 1000
    const key = KEY_DAY_PREFIX + dayKey(ts)
    const rows = await host.storage.get<ToolInvocation[]>(key, [])
    if (!Array.isArray(rows) || rows.length === 0) continue
    const idx = rows.findIndex((r) => r.toolCallId === toolCallId)
    if (idx < 0) continue
    const row = rows[idx]!
    if (row.completed) return
    const updated: ToolInvocation = {
      ...row,
      durationMs,
      completed: true,
    }
    const next = [...rows]
    next[idx] = updated
    await host.storage.set(key, next)
    await bumpLifetime(host, 0, durationMs ?? 0, +1, -1)
    return
  }
}

async function bumpLifetime(
  host: MainHost,
  callsDelta: number,
  durationDelta: number,
  completedDelta: number,
  unfinishedDelta: number,
): Promise<void> {
  const cur = await host.storage.get<BucketTotals>(KEY_LIFETIME, emptyTotals())
  await host.storage.set(KEY_LIFETIME, {
    ...cur,
    calls: cur.calls + callsDelta,
    totalDurationMs: cur.totalDurationMs + durationDelta,
    unfinished: cur.unfinished + unfinishedDelta,
    // distinctTools is meaningless at lifetime granularity (would
    // require a separate set in storage); leave it untouched.
    distinctTools: cur.distinctTools,
  })
  // completedDelta currently unused at lifetime totals — we infer
  // "completed = calls - unfinished" on the consumer side.
  void completedDelta
}

export async function readDay(
  host: MainHost,
  day: string,
): Promise<ToolInvocation[]> {
  const v = await host.storage.get<ToolInvocation[]>(KEY_DAY_PREFIX + day, [])
  return Array.isArray(v) ? v : []
}

export async function readRecentDays(
  host: MainHost,
  count: number,
): Promise<Array<{ day: string; rows: ToolInvocation[] }>> {
  const out: Array<{ day: string; rows: ToolInvocation[] }> = []
  for (let i = 0; i < count; i++) {
    const ts = Date.now() - i * 24 * 60 * 60 * 1000
    const k = dayKey(ts)
    out.push({ day: k, rows: await readDay(host, k) })
  }
  return out
}

export async function readLifetime(host: MainHost): Promise<BucketTotals> {
  return host.storage.get<BucketTotals>(KEY_LIFETIME, emptyTotals())
}

/**
 * Aggregate a set of invocations into a single BucketTotals.
 * Distinct-tool count uses a Set — cheap for the volumes we see.
 */
export function aggregate(
  rows: Iterable<ToolInvocation>,
): BucketTotals & { tools: Set<string> } {
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

export function aggregateToBucket(
  rows: Iterable<ToolInvocation>,
  day: string,
): DayBucket {
  const a = aggregate(rows)
  return {
    day,
    calls: a.calls,
    distinctTools: a.distinctTools,
    totalDurationMs: a.totalDurationMs,
    unfinished: a.unfinished,
  }
}

export { emptyDay }
