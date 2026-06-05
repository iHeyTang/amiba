/**
 * Tool-meter main runner.
 *
 * Subscribes to host.chat.onEvent("tool.started" / "tool.completed"),
 * persists each invocation to host.storage, and exposes aggregated
 * views to the UI panel via IPC.
 *
 * Storage layout mirrors token-meter's predecessor (per-day buckets
 * + lifetime aggregate) — see ./storage.ts. The IPC channels in turn
 * mirror token-meter so the UI can use the same shared shapes.
 */

import type {
  ChatToolCompletedEvent,
  ChatToolStartedEvent,
  MainActivate,
} from "@hermes-x/extension-api"

import type {
  DayBucket,
  HeatmapCell,
  HeatmapToolShare,
  MeterSummary,
  ToolInvocation,
  ToolPerDay,
} from "../shared/types"
import {
  aggregate,
  aggregateToBucket,
  appendInvocation,
  dayKey,
  emptyDay,
  emptyTotals,
  markCompleted,
  readDay,
  readLifetime,
  readRecentDays,
} from "./storage"

export const activate: MainActivate = async (host) => {
  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  host.chat.onEvent("tool.started", (e: ChatToolStartedEvent) => {
    void appendInvocation(host, {
      ts: e.startedAt ?? Date.now(),
      sessionId: e.sessionId,
      runId: e.runId,
      tool: e.tool,
      toolCallId: e.toolCallId,
      completed: false,
    }).catch((err) => host.logger.warn("tool-meter: appendInvocation failed:", err))
  })

  host.chat.onEvent("tool.completed", (e: ChatToolCompletedEvent) => {
    void markCompleted(host, e.toolCallId, e.durationMs).catch((err) =>
      host.logger.warn("tool-meter: markCompleted failed:", err),
    )
  })

  // ---------------------------------------------------------------------------
  // IPC
  // ---------------------------------------------------------------------------

  host.ipc.expose<void, MeterSummary>("meter.summary", async () => {
    const todayKey = dayKey(Date.now())
    const recentRaw = await readRecentDays(host, 7)
    const lifetime = await readLifetime(host)

    const todayRows = recentRaw.find((r) => r.day === todayKey)?.rows ?? []
    const today: DayBucket = aggregateToBucket(todayRows, todayKey)

    const last7Days: DayBucket[] = recentRaw.map(({ day, rows }) =>
      aggregateToBucket(rows, day),
    )

    // Per-tool perDay matrix. Pre-seed empty days per tool so the UI
    // can slice the first N without nil-checking.
    const toolDays = new Map<string, Map<string, DayBucket>>()
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
          for (const d of dayOrder) perDay.set(d, emptyDay(d))
          toolDays.set(tool, perDay)
        }
        perDay.set(day, aggregateToBucket(list, day))
      }
    }
    const byToolLast7: ToolPerDay[] = [...toolDays.entries()]
      .map(([tool, m]) => ({
        tool,
        perDay: dayOrder.map((d) => m.get(d) ?? emptyDay(d)),
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
  })

  host.ipc.expose<{ limit?: number }, ToolInvocation[]>(
    "meter.recent",
    async (args) => {
      const limit = Math.max(1, Math.min(args?.limit ?? 30, 200))
      const out: ToolInvocation[] = []
      // Walk recent days back until we collect `limit`.
      for (let i = 0; i < 30 && out.length < limit; i++) {
        const ts = Date.now() - i * 24 * 60 * 60 * 1000
        const rows = await readDay(host, dayKey(ts))
        for (let j = rows.length - 1; j >= 0 && out.length < limit; j--) {
          out.push(rows[j]!)
        }
      }
      return out
    },
  )

  host.ipc.expose<{ weeks?: number }, HeatmapCell[]>(
    "meter.heatmap",
    async (args) => {
      const weeks = Math.max(1, Math.min(args?.weeks ?? 12, 52))
      const days = weeks * 7

      // Per-day totals + per-tool contributions across the window.
      const perDay = new Map<
        string,
        { calls: number; byTool: Map<string, number> }
      >()
      for (let i = 0; i < days; i++) {
        const ts = Date.now() - i * 24 * 60 * 60 * 1000
        const k = dayKey(ts)
        const rows = await readDay(host, k)
        if (rows.length === 0) continue
        const a = aggregate(rows)
        const byTool = new Map<string, number>()
        for (const r of rows) {
          byTool.set(r.tool, (byTool.get(r.tool) ?? 0) + 1)
        }
        perDay.set(k, { calls: a.calls, byTool })
      }

      // Build the window cells oldest-first.
      const cells: Array<Omit<HeatmapCell, "level">> = []
      for (let i = days - 1; i >= 0; i--) {
        const ts = Date.now() - i * 24 * 60 * 60 * 1000
        const k = dayKey(ts)
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

      return cells.map((c): HeatmapCell => {
        let level: HeatmapCell["level"] = 0
        if (c.value > 0) {
          if (c.value > q3) level = 4
          else if (c.value > q2) level = 3
          else if (c.value > q1) level = 2
          else level = 1
        }
        return { ...c, level }
      })
    },
  )
}

// Suppress unused-emptyTotals warning: keep it exported via storage.
void emptyTotals
