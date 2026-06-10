/**
 * Poll the gateway's cron-session feed and push new completions to the
 * Heads-up Notifier.
 *
 * Source of truth is SessionDB — same data ``hermes sessions list
 * --source cron`` returns, so the watcher stays consistent with the
 * official CLI and any cleanup commands the user runs against it. The
 * previous implementation scanned ``~/.hermes/cron/output/*.md`` via
 * ``listCronRuns``; that index lived parallel to SessionDB and
 * surfaced runs that never produced a session row, which was confusing
 * once the sidebar moved to the SessionDB view as well.
 *
 * We poll on a 30s interval, dedupe by session id, and emit a
 * ``cron-completed`` toast for each session whose ``ended_at`` we
 * haven't previously seen. Hermes sets ``ended_at`` only after the
 * agent has wrapped up (``end_session("cron_complete")`` in
 * ``cron/scheduler.py``), so the toast fires on completion rather than
 * at the start of a run.
 *
 * Friendly job titles come from a cached ``getHermesCronJobs()`` map,
 * refreshed lazily — when a user adds/renames a job, the next refresh
 * (≤60s) picks it up. Falls back to the parsed ``job_id`` if no live
 * config matches (e.g. the job was removed but old sessions remain).
 *
 * Failure modes are explicitly silent: if the gateway is still booting,
 * the backplane isn't up, or no cron jobs exist, the list call rejects
 * — we swallow the error and try again next tick. That keeps the
 * watcher decoupled from the runtime / install flow.
 */
import {
  getHermesCronJobs,
  listHermesSessions,
  parseCronSessionJobId,
  type HermesSession,
} from "@amiba/core"

import { sendToNotifier } from "./notifier-window"

const POLL_INTERVAL_MS = 30_000
const FETCH_LIMIT = 50
/** How stale a cached job-name map can be before we re-fetch. */
const JOBS_TTL_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null
let seen = new Set<string>()
let primed = false

/** Cached ``{job_id → name}`` map for friendly toast titles. */
let jobNames = new Map<string, string>()
let jobNamesFetchedAt = 0

async function refreshJobNamesIfStale(): Promise<void> {
  if (Date.now() - jobNamesFetchedAt < JOBS_TTL_MS && jobNames.size > 0) return
  try {
    const r = await getHermesCronJobs()
    if (r.ok) {
      jobNames = new Map(r.jobs.map((j) => [j.id, j.name || j.id]))
      jobNamesFetchedAt = Date.now()
    }
  } catch {
    // Best-effort: stale cache is fine, we'll fall back to the parsed
    // job id when looking up titles.
  }
}

function titleForSession(s: HermesSession): string {
  const jobId = parseCronSessionJobId(s.id)
  if (!jobId) return s.title || "Cron run"
  return jobNames.get(jobId) || jobId
}

function summarize(s: HermesSession): string {
  // SessionDB doesn't carry the rendered cron output body, so we can't
  // reproduce the previous "first 280 chars of the run's markdown" toast
  // detail without an extra ``getHermesMessages`` round-trip per session.
  // The preview field (first 60 chars of the first user msg = the cron
  // prompt) is a reasonable hint at "which job this was about" since the
  // title already says the job name. Empty/missing preview falls back
  // to a generic completion line.
  const preview = (s.preview || "").replace(/\s+/g, " ").trim()
  if (preview) return preview
  return "Cron run completed."
}

async function tick(): Promise<void> {
  await refreshJobNamesIfStale()

  let sessions: HermesSession[]
  try {
    const r = await listHermesSessions({ source: "cron", limit: FETCH_LIMIT })
    if (!("ok" in r) || !r.ok) {
      // Gateway/backplane returned an error envelope — try again next
      // tick rather than tearing down the watcher.
      return
    }
    sessions = r.sessions
  } catch {
    // Network/transport blip; backplane probably still warming up.
    return
  }

  // Only ended runs are "completed". In-flight cron sessions
  // (``ended_at == null``) are skipped — we'll pick them up on the
  // next tick after the agent finalises.
  const ended = sessions.filter((s) => s.ended_at != null)

  if (!primed) {
    // First successful fetch: seed the dedupe set so we don't avalanche
    // toasts for runs that already finished before the app launched.
    for (const s of ended) seen.add(s.id)
    primed = true
    return
  }

  // Surface newly-completed sessions in chronological order. SessionDB
  // returns newest-first; we reverse the unseen subset so the notifier
  // stack reads top→bottom == oldest→newest.
  const fresh: HermesSession[] = []
  for (const s of ended) {
    if (seen.has(s.id)) continue
    fresh.push(s)
    seen.add(s.id)
  }
  fresh.reverse()

  for (const s of fresh) {
    const endedAtMs = (s.ended_at ?? s.last_active ?? s.started_at) * 1000
    sendToNotifier({
      type: "cron-completed",
      id: s.id,
      title: titleForSession(s),
      summary: summarize(s),
      timestamp: endedAtMs,
    })
  }

  // Bound the dedupe set so a year of uptime doesn't grow it without
  // limit. We keep at least the last FETCH_LIMIT*4 keys — enough that a
  // single poll can't possibly re-introduce a key we just dropped.
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
  jobNames.clear()
  jobNamesFetchedAt = 0
}
