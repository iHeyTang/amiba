/**
 * Poll the gateway's cron-run feed and push new completions to the
 * Heads-up Notifier.
 *
 * The gateway exposes a list endpoint (`GET /hermes/cron/runs`) but no
 * push channel — we poll on a 30s interval, dedupe by composite
 * `(jobId, runId)` key, and emit a `cron-completed` toast for each run
 * we haven't seen before. The first poll seeds the dedupe set silently
 * so the notifier doesn't avalanche on app launch.
 *
 * Failure modes are explicitly silent: if the gateway is still booting,
 * the backplane isn't up, or the user hasn't installed any cron jobs,
 * `listCronRuns` rejects — we swallow the error and try again next tick.
 * That keeps the watcher decoupled from the runtime / install flow.
 */
import { cronRunKey, listCronRuns, type CronRun } from "@hermes-x/core"

import { sendToNotifier } from "./notifier-window"

const POLL_INTERVAL_MS = 30_000
const FETCH_LIMIT = 50

let timer: ReturnType<typeof setInterval> | null = null
let seen = new Set<string>()
let primed = false

function summarize(run: CronRun): string {
  // The gateway already trims to a sensible cap; we just collapse
  // whitespace for the 3-line toast layout.
  const body = (run.content || "").replace(/\s+/g, " ").trim()
  if (!body) {
    return run.status === "error"
      ? "Cron run failed (no output)."
      : "Cron run completed (no output)."
  }
  // Cap at ~280 chars — the notifier card line-clamps to 3 lines anyway,
  // so anything beyond this is paying ipc cost for content we'll never
  // render.
  return body.length > 280 ? body.slice(0, 277) + "…" : body
}

async function tick(): Promise<void> {
  let runs: CronRun[]
  try {
    const r = await listCronRuns({ limit: FETCH_LIMIT })
    runs = r.runs
  } catch {
    // Gateway not up / no plugin / network blip — try again next interval.
    return
  }

  if (!primed) {
    // First successful fetch: seed the dedupe set so we don't avalanche
    // toasts for runs that already happened before the app launched.
    for (const r of runs) seen.add(cronRunKey(r))
    primed = true
    return
  }

  // Process oldest-first so notifier order matches chronological order
  // even though listCronRuns returns newest-first.
  const fresh: CronRun[] = []
  for (const r of runs) {
    const k = cronRunKey(r)
    if (seen.has(k)) continue
    fresh.push(r)
    seen.add(k)
  }
  fresh.reverse()

  for (const run of fresh) {
    sendToNotifier({
      type: "cron-completed",
      id: cronRunKey(run),
      title: run.jobName || "Cron run",
      summary: summarize(run),
      timestamp: run.runAtMs,
    })
  }

  // Bound the dedupe set so a year of uptime doesn't grow it without
  // limit. We keep at least the last FETCH_LIMIT*4 keys — enough that
  // a single poll can't possibly re-introduce a key we just dropped.
  const MAX_SEEN = FETCH_LIMIT * 4
  if (seen.size > MAX_SEEN) {
    const arr = Array.from(seen)
    seen = new Set(arr.slice(arr.length - MAX_SEEN))
  }
}

/**
 * Start the polling loop. Safe to call multiple times — only one timer
 * is ever active. The first tick fires immediately so the dedupe set is
 * seeded as soon as the gateway is reachable.
 */
export function startCronWatcher(): void {
  if (timer) return
  void tick()
  timer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)
}

export function stopCronWatcher(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
  seen.clear()
  primed = false
}
