/**
 * Hook that pulls "scheduled task" entries from SessionDB instead of
 * the cron-run markdown feed. Mirrors what ``hermes sessions list
 * --source cron`` shows in the CLI, so the desktop's Scheduled-tasks
 * group stays in sync with the upstream concept of a cron session.
 *
 * Trade-off vs. ``useCronRuns``:
 *   - ✅ Single canonical source (SessionDB) — cleanup via ``hermes
 *     sessions delete`` or any other official command actually reflects
 *     in the UI.
 *   - ❌ Loses visibility on cron triggers that never wrote a session
 *     row (``no_agent`` scripts, silent skips, gateway failures before
 *     ``create_session``). Those still live as markdown files under
 *     ``~/.hermes/cron/output/`` but are intentionally not surfaced
 *     here — matching the CLI's behaviour is the explicit goal.
 *
 * The runtime nominates each session by its id naming convention
 * ``cron_{job_id}_{YYYYMMDD_HHMMSS}`` (see
 * ``cron/scheduler.py``). Callers that need the bare job-id without
 * the timestamp tail can use ``parseCronSessionJobId``.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { listHermesSessions, type HermesSession } from "../hermes-sessions";

const FETCH_LIMIT = 500;

export interface CronSessionsController {
  /** True once the first fetch settles (success or failure). */
  ready: boolean;
  /** Newest-first by ``started_at``. */
  sessions: HermesSession[];
  /** Last error message, ``null`` when the most recent fetch succeeded. */
  error: string | null;
  refresh: () => Promise<void>;
}

function sortNewestFirst(sessions: HermesSession[]): HermesSession[] {
  return [...sessions].sort((a, b) => {
    const aT = a.last_active ?? a.started_at;
    const bT = b.last_active ?? b.started_at;
    return bT - aT;
  });
}

export function useCronSessions(): CronSessionsController {
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  const doFetch = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const p = (async () => {
      try {
        const r = await listHermesSessions({
          source: "cron",
          limit: FETCH_LIMIT,
        });
        if (!mounted.current) return;
        if ("ok" in r && r.ok) {
          setSessions(sortNewestFirst(r.sessions));
          setError(null);
        } else {
          setError("error" in r ? r.error : "listHermesSessions failed");
        }
      } catch (e) {
        if (!mounted.current) return;
        setError((e as Error)?.message || String(e));
      } finally {
        if (mounted.current) setReady(true);
        inFlight.current = null;
      }
    })();
    inFlight.current = p;
    return p;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void doFetch();
    return () => {
      mounted.current = false;
    };
  }, [doFetch]);

  return { ready, sessions, error, refresh: doFetch };
}

/**
 * Extract the originating cron-job id from a SessionDB cron session id.
 * The upstream naming convention is ``cron_{job_id}_{YYYYMMDD_HHMMSS}``
 * (``cron/scheduler.py``). ``job_id`` itself may contain underscores
 * — we anchor on the trailing 15-char timestamp so the rest of the
 * string belongs to the job id.
 *
 * Returns ``null`` when the id doesn't match the convention (e.g. a
 * synthesised id from an older desktop import path).
 */
export function parseCronSessionJobId(sessionId: string): string | null {
  const m = /^cron_(.+)_\d{8}_\d{6}$/.exec(sessionId);
  return m?.[1] ?? null;
}
