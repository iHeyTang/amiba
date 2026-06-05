/**
 * Token-meter main runner.
 *
 * Pure read-through over hermes-agent's session list. No local
 * storage, no event subscription, no cost computation. Every IPC
 * handler pulls `GET /api/sessions` via the host bridge and
 * aggregates on demand.
 *
 * Cost is deliberately not surfaced (see shared/types.ts header) —
 * the panel reports tokens only.
 */

import type { HermesSessionInfo, MainActivate } from "@hermes-x/extension-api"

import type {
  DayBucket,
  HeatmapCell,
  HeatmapModelShare,
  MeterSummary,
  ModelPerDay,
  TurnUsage,
} from "../shared/types"

const SESSION_FETCH_LIMIT = 200

function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function emptyTotals() {
  return {
    turns: 0,
    sessions: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
}

interface SessionRow {
  sessionId: string
  model: string
  lastActiveTs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  messageCount: number
}

function normalize(s: HermesSessionInfo): SessionRow | null {
  if (!s || typeof s.id !== "string") return null
  const lastActiveSec =
    typeof s.last_active === "number"
      ? s.last_active
      : typeof s.started_at === "number"
        ? s.started_at
        : 0
  const lastActiveTs = lastActiveSec > 0 ? Math.round(lastActiveSec * 1000) : 0
  if (lastActiveTs === 0) return null
  const prompt = s.input_tokens ?? 0
  const completion = s.output_tokens ?? 0
  return {
    sessionId: s.id,
    model: s.model ?? "",
    lastActiveTs,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    messageCount: s.message_count ?? 0,
  }
}

function addSession<T extends ReturnType<typeof emptyTotals>>(t: T, row: SessionRow): T {
  return {
    ...t,
    turns: t.turns + row.messageCount,
    sessions: t.sessions + 1,
    promptTokens: t.promptTokens + row.promptTokens,
    completionTokens: t.completionTokens + row.completionTokens,
    totalTokens: t.totalTokens + row.totalTokens,
  }
}

export const activate: MainActivate = async (host) => {
  async function fetchRows(): Promise<SessionRow[]> {
    const raw = await host.hermes.listSessions({ limit: SESSION_FETCH_LIMIT })
    const rows: SessionRow[] = []
    for (const s of raw) {
      const n = normalize(s)
      if (n) rows.push(n)
    }
    rows.sort((a, b) => b.lastActiveTs - a.lastActiveTs)
    return rows
  }

  host.ipc.expose<void, MeterSummary>("meter.summary", async () => {
    const rows = await fetchRows()
    const todayKey = dayKey(new Date())

    let today: DayBucket = { day: todayKey, ...emptyTotals() }
    let lifetime = emptyTotals()
    const last7Map = new Map<string, DayBucket>()
    // model -> dayKey -> DayBucket. We bucket per-day per-model so the
    // UI can sum any window length (today / 3d / 7d) client-side
    // without bouncing back through the runner.
    const byModelDay = new Map<string, Map<string, DayBucket>>()

    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const k = dayKey(d)
      last7Map.set(k, { day: k, ...emptyTotals() })
    }

    for (const row of rows) {
      lifetime = { ...addSession(lifetime, row) }

      const k = dayKey(new Date(row.lastActiveTs))
      const inWindow = last7Map.has(k)

      if (k === todayKey) {
        today = { ...addSession(today, row), day: todayKey }
      }

      if (inWindow) {
        const dayBucket = last7Map.get(k)!
        last7Map.set(k, { ...addSession(dayBucket, row), day: k })

        const modelKey = row.model || "(unknown)"
        let modelDays = byModelDay.get(modelKey)
        if (!modelDays) {
          modelDays = new Map()
          // Pre-seed all 7 days so the UI sees a stable shape.
          for (const dk of last7Map.keys()) {
            modelDays.set(dk, { day: dk, ...emptyTotals() })
          }
          byModelDay.set(modelKey, modelDays)
        }
        const cur = modelDays.get(k) ?? { day: k, ...emptyTotals() }
        modelDays.set(k, { ...addSession(cur, row), day: k })
      }
    }

    // Newest day first for both shapes.
    const dayOrder: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dayOrder.push(dayKey(d))
    }
    const last7Days: DayBucket[] = dayOrder.map(
      (k) => last7Map.get(k) ?? { day: k, ...emptyTotals() },
    )

    const byModelLast7: ModelPerDay[] = [...byModelDay.entries()]
      .map(([model, days]) => ({
        model,
        perDay: dayOrder.map(
          (k) => days.get(k) ?? { day: k, ...emptyTotals() },
        ),
      }))
      // Initial order is window-total tokens desc. UI re-sorts if it
      // narrows the range further (a model that's #1 over 7d may not
      // be #1 today).
      .sort((a, b) => {
        const ta = a.perDay.reduce((s, d) => s + d.totalTokens, 0)
        const tb = b.perDay.reduce((s, d) => s + d.totalTokens, 0)
        return tb - ta
      })

    return {
      generatedAt: Date.now(),
      today,
      last7Days,
      byModelLast7,
      lifetime,
    }
  })

  host.ipc.expose<{ limit?: number }, TurnUsage[]>("meter.recent", async (args) => {
    const limit = Math.max(1, Math.min(args?.limit ?? 20, 200))
    const rows = await fetchRows()
    return rows.slice(0, limit).map<TurnUsage>((r) => ({
      ts: r.lastActiveTs,
      sessionId: r.sessionId,
      model: r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
    }))
  })

  host.ipc.expose<{ weeks?: number }, HeatmapCell[]>("meter.heatmap", async (args) => {
    const weeks = Math.max(1, Math.min(args?.weeks ?? 12, 52))
    const days = weeks * 7
    const rows = await fetchRows()

    // Per-day total tokens + per-day per-model contribution.
    interface DayAgg {
      tokens: number
      byModel: Map<string, number>
    }
    const perDay = new Map<string, DayAgg>()
    for (const r of rows) {
      const k = dayKey(new Date(r.lastActiveTs))
      const cur = perDay.get(k) ?? { tokens: 0, byModel: new Map() }
      cur.tokens += r.totalTokens
      const modelKey = r.model || "(unknown)"
      cur.byModel.set(modelKey, (cur.byModel.get(modelKey) ?? 0) + r.totalTokens)
      perDay.set(k, cur)
    }

    // Build the window (oldest first).
    const cells: Array<Omit<HeatmapCell, "level">> = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const k = dayKey(d)
      const agg = perDay.get(k)
      const tokens = agg?.tokens ?? 0
      const breakdown: HeatmapModelShare[] = agg
        ? [...agg.byModel.entries()]
            .map(([model, t]) => ({ model, tokens: t }))
            .sort((a, b) => b.tokens - a.tokens)
        : []
      cells.push({ day: k, tokens, modelBreakdown: breakdown })
    }

    // Quartile bucket against non-zero days.
    const nonZero = cells.map((c) => c.tokens).filter((v) => v > 0).sort((a, b) => a - b)
    const q = (frac: number) =>
      nonZero.length === 0
        ? 0
        : nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * frac))]!
    const q1 = q(0.25)
    const q2 = q(0.5)
    const q3 = q(0.75)

    return cells.map((c): HeatmapCell => {
      let level: HeatmapCell["level"] = 0
      if (c.tokens > 0) {
        if (c.tokens > q3) level = 4
        else if (c.tokens > q2) level = 3
        else if (c.tokens > q1) level = 2
        else level = 1
      }
      return { ...c, level }
    })
  })
}
