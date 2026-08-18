/**
 * Tool-activity recorder — captures the process-wide DSH `tool.started` /
 * `tool.completed` projection into per-day JSON buckets on disk and serves
 * them back to the renderer's Usage page over IPC.
 *
 * Layout under `<userData>/tool-activity/`:
 *   YYYY-MM-DD.json → ToolInvocation[]   (local-tz day buckets)
 *   lifetime.json   → ToolActivityTotals (running aggregate)
 *
 * Lives in main (not the renderer) so counting continues while every
 * window is closed. All writes funnel through a single promise chain —
 * tool events can land back-to-back and a read-modify-write race would
 * drop rows.
 */

import { mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { app, BrowserWindow, ipcMain } from "electron"
import {
  emptyToolActivityTotals,
  toolActivityDayKey,
  type ToolActivityReadResult,
  type ToolActivityTotals,
  type ToolInvocation,
} from "@amiba/app-runtime/core"

const DAY_MS = 24 * 60 * 60 * 1000
/** How many days back markCompleted searches for the started row. */
const COMPLETE_LOOKBACK_DAYS = 7
/** Hard cap on the IPC read window (52 weeks of heatmap). */
const MAX_READ_DAYS = 366

let rootDir: string | null = null
let queue: Promise<void> = Promise.resolve()

function dayPath(day: string): string {
  return join(rootDir!, `${day}.json`)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function readDay(day: string): Promise<ToolInvocation[]> {
  const v = await readJson<ToolInvocation[]>(dayPath(day), [])
  return Array.isArray(v) ? v : []
}

async function readLifetime(): Promise<ToolActivityTotals> {
  return readJson<ToolActivityTotals>(
    join(rootDir!, "lifetime.json"),
    emptyToolActivityTotals(),
  )
}

async function writeLifetime(totals: ToolActivityTotals): Promise<void> {
  await writeFile(join(rootDir!, "lifetime.json"), JSON.stringify(totals))
}

/** Serialize mutations; a failed step logs and never poisons the chain. */
function enqueue(step: () => Promise<void>): void {
  queue = queue
    .then(step)
    .then(scheduleChangedBroadcast)
    .catch((err) => {
      console.warn("[tool-activity] write failed:", err)
    })
}

/**
 * Push "the ledger changed" to every renderer so the Tools page's
 * Activity tab can refetch immediately (no polling). Tool events come
 * in start/complete pairs and bursts, so coalesce with a short trailing
 * debounce — the renderer refetch costs three ledger reads.
 */
const CHANGED_DEBOUNCE_MS = 300
let changedTimer: ReturnType<typeof setTimeout> | null = null

function scheduleChangedBroadcast(): void {
  if (changedTimer) return
  changedTimer = setTimeout(() => {
    changedTimer = null
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.isDestroyed()) continue
      win.webContents.send("tool-activity:changed")
    }
  }, CHANGED_DEBOUNCE_MS)
}

function appendInvocation(inv: ToolInvocation): void {
  enqueue(async () => {
    const day = toolActivityDayKey(inv.ts)
    const rows = await readDay(day)
    rows.push(inv)
    await writeFile(dayPath(day), JSON.stringify(rows))
    const life = await readLifetime()
    await writeLifetime({
      ...life,
      calls: life.calls + 1,
      unfinished: life.unfinished + 1,
    })
  })
}

function markCompleted(toolCallId: string, durationMs: number | undefined): void {
  enqueue(async () => {
    // Walk recent days — a tool can technically span midnight, but 99%
    // of the time the started row is in today's bucket.
    for (let i = 0; i < COMPLETE_LOOKBACK_DAYS; i++) {
      const day = toolActivityDayKey(Date.now() - i * DAY_MS)
      const rows = await readDay(day)
      const idx = rows.findIndex((r) => r.toolCallId === toolCallId)
      if (idx < 0) continue
      const row = rows[idx]!
      if (row.completed) return
      rows[idx] = { ...row, durationMs, completed: true }
      await writeFile(dayPath(day), JSON.stringify(rows))
      const life = await readLifetime()
      await writeLifetime({
        ...life,
        totalDurationMs: life.totalDurationMs + (durationMs ?? 0),
        unfinished: Math.max(0, life.unfinished - 1),
      })
      return
    }
  })
}

interface ToolStartedPayload {
  sessionId?: string
  runId?: string
  tool?: string
  toolCallId?: string
  startedAt?: number
}

interface ToolCompletedPayload extends ToolStartedPayload {
  durationMs?: number
}

/**
 * DSH event sink. Compose with other DSH-owned telemetry consumers in
 * `setChatEventPublisher` — same event names + payloads either way.
 */
export function recordToolActivityEvent(event: string, payload: unknown): void {
  if (!rootDir) return
  if (event === "tool.started") {
    const p = (payload ?? {}) as ToolStartedPayload
    if (!p.tool || !p.toolCallId) return
    appendInvocation({
      ts: p.startedAt ?? Date.now(),
      sessionId: p.sessionId,
      runId: p.runId,
      tool: p.tool,
      toolCallId: p.toolCallId,
      completed: false,
    })
  } else if (event === "tool.completed") {
    const p = (payload ?? {}) as ToolCompletedPayload
    if (!p.toolCallId) return
    markCompleted(p.toolCallId, p.durationMs)
  }
}

/**
 * Create the storage dir and register the renderer-facing read channel.
 * Call once at boot, before the first window loads.
 */
export function registerToolActivity(): void {
  rootDir = join(app.getPath("userData"), "tool-activity")
  mkdirSync(rootDir, { recursive: true })

  ipcMain.handle(
    "tool-activity:read",
    async (_e, args: { days?: number }): Promise<ToolActivityReadResult> => {
      const days = Math.max(1, Math.min(args?.days ?? 7, MAX_READ_DAYS))
      // Flush pending writes so a read right after a tool event sees it.
      await queue
      const out: ToolActivityReadResult = {
        days: [],
        lifetime: await readLifetime(),
      }
      for (let i = 0; i < days; i++) {
        const day = toolActivityDayKey(Date.now() - i * DAY_MS)
        out.days.push({ day, rows: await readDay(day) })
      }
      return out
    },
  )
}
