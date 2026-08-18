/**
 * Client-side aggregation for the Tools activity tab.
 *
 * Faithful port of the tool-meter extension's main-process IPC handlers
 * (meter.summary / meter.recent / meter.heatmap) onto a host-injected
 * `ToolActivityReader`. The reader returns raw per-day invocation rows
 * (most recent day first, exactly the requested count) plus the lifetime
 * aggregate; everything here is pure client-side crunching.
 */

import {
  aggregateToolActivity,
  aggregateToolActivityToBucket,
  emptyToolActivityDay,
  toolActivityDayKey,
  type ToolActivityDayBucket,
  type ToolActivityReader,
  type ToolActivityTotals,
  type ToolInvocation,
} from "@amiba/app-runtime/core"

import type { HeatmapCellBase } from "../viz"

// ---------------------------------------------------------------------------
// Wire types (ported from the extension's shared/types.ts)
// ---------------------------------------------------------------------------

export interface ToolPerDay {
  tool: string
  perDay: ToolActivityDayBucket[]
}

export interface MeterSummary {
  generatedAt: number
  today: ToolActivityDayBucket
  /** Newest day first. */
  last7Days: ToolActivityDayBucket[]
  /** Per-tool breakdown over the same 7-day window. UI sums the
   *  first N entries when the user picks a shorter range. */
  byToolLast7: ToolPerDay[]
  lifetime: ToolActivityTotals
}

export interface HeatmapToolShare {
  tool: string
  calls: number
}

/**
 * Heatmap cell. `value` is the day's total call count so the shared
 * Heatmap can render it. `toolBreakdown` powers the hover popover's
 * per-tool detail rows.
 */
export interface ToolHeatmapCell extends HeatmapCellBase {
  toolBreakdown: HeatmapToolShare[]
}

// ---------------------------------------------------------------------------
// Aggregation (ported from the extension's main/index.ts IPC handlers)
// ---------------------------------------------------------------------------

/** Port of the ext's "meter.summary" handler. */
export async function fetchToolSummary(
  reader: ToolActivityReader,
): Promise<MeterSummary> {
  const todayKey = toolActivityDayKey(Date.now())
  const { days: recentRaw, lifetime } = await reader(7)

  const todayRows = recentRaw.find((r) => r.day === todayKey)?.rows ?? []
  const today: ToolActivityDayBucket = aggregateToolActivityToBucket(
    todayRows,
    todayKey,
  )

  const last7Days: ToolActivityDayBucket[] = recentRaw.map(({ day, rows }) =>
    aggregateToolActivityToBucket(rows, day),
  )

  // Per-tool perDay matrix. Pre-seed empty days per tool so the UI
  // can slice the first N without nil-checking.
  const toolDays = new Map<string, Map<string, ToolActivityDayBucket>>()
  const dayOrder = recentRaw.map((r) => r.day)
  for (const { day, rows } of recentRaw) {
    const byTool = new Map<string, ToolInvocation[]>()
    for (const r of rows) {
      const acc = byTool.get(r.tool) ?? []
      acc.push(r)
      byTool.set(r.tool, acc)
    }
    for (const [tool, list] of byTool.entries()) {
      let perDay = toolDays.get(tool)
      if (!perDay) {
        perDay = new Map()
        for (const d of dayOrder) perDay.set(d, emptyToolActivityDay(d))
        toolDays.set(tool, perDay)
      }
      perDay.set(day, aggregateToolActivityToBucket(list, day))
    }
  }
  const byToolLast7: ToolPerDay[] = [...toolDays.entries()]
    .map(([tool, m]) => ({
      tool,
      perDay: dayOrder.map((d) => m.get(d) ?? emptyToolActivityDay(d)),
    }))
    .sort((a, b) => {
      const ca = a.perDay.reduce((s, d) => s + d.calls, 0)
      const cb = b.perDay.reduce((s, d) => s + d.calls, 0)
      return cb - ca
    })

  return {
    generatedAt: Date.now(),
    today,
    last7Days,
    byToolLast7,
    lifetime,
  }
}

/** Port of the ext's "meter.recent" handler. */
export async function fetchToolRecent(
  reader: ToolActivityReader,
  limit: number,
): Promise<ToolInvocation[]> {
  const capped = Math.max(1, Math.min(limit, 200))
  const { days } = await reader(30)
  const out: ToolInvocation[] = []
  // Walk recent days back (newest first) until we collect `limit`;
  // within a day, rows are append-ordered so iterate from the end.
  for (const { rows } of days) {
    if (out.length >= capped) break
    for (let j = rows.length - 1; j >= 0 && out.length < capped; j--) {
      out.push(rows[j]!)
    }
  }
  return out
}

/** Port of the ext's "meter.heatmap" handler. */
export async function fetchToolHeatmap(
  reader: ToolActivityReader,
  weeks: number,
): Promise<ToolHeatmapCell[]> {
  const cappedWeeks = Math.max(1, Math.min(weeks, 52))
  const { days: rawDays } = await reader(cappedWeeks * 7)

  // Per-day totals + per-tool contributions across the window.
  const perDay = new Map<string, { calls: number; byTool: Map<string, number> }>()
  for (const { day, rows } of rawDays) {
    if (rows.length === 0) continue
    const a = aggregateToolActivity(rows)
    const byTool = new Map<string, number>()
    for (const r of rows) {
      byTool.set(r.tool, (byTool.get(r.tool) ?? 0) + 1)
    }
    perDay.set(day, { calls: a.calls, byTool })
  }

  // Build the window cells oldest-first (rawDays arrives newest-first).
  const cells: Array<Omit<ToolHeatmapCell, "level">> = []
  for (let i = rawDays.length - 1; i >= 0; i--) {
    const k = rawDays[i]!.day
    const agg = perDay.get(k)
    const breakdown: HeatmapToolShare[] = agg
      ? [...agg.byTool.entries()]
          .map(([tool, calls]) => ({ tool, calls }))
          .sort((a, b) => b.calls - a.calls)
      : []
    cells.push({ day: k, value: agg?.calls ?? 0, toolBreakdown: breakdown })
  }

  const nonZero = cells.map((c) => c.value).filter((v) => v > 0).sort((a, b) => a - b)
  const q = (frac: number) =>
    nonZero.length === 0
      ? 0
      : nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * frac))]!
  const q1 = q(0.25)
  const q2 = q(0.5)
  const q3 = q(0.75)

  return cells.map((c): ToolHeatmapCell => {
    let level: ToolHeatmapCell["level"] = 0
    if (c.value > 0) {
      if (c.value > q3) level = 4
      else if (c.value > q2) level = 3
      else if (c.value > q1) level = 2
      else level = 1
    }
    return { ...c, level }
  })
}
