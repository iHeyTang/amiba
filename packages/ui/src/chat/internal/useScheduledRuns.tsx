/**
 * Cron-run data for History + the top-bar cron title. Cron sessions come
 * from `useCronSessions` (the main session index hides them) and are re-keyed
 * by JOB ID so the unified list view groups runs under their parent job.
 */
import { Loader2, Zap } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import {
  getHermesCronJobs,
  parseCronSessionJobId,
  triggerHermesCronJob,
  useCronSessions,
  type SessionMeta,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { cn } from "../../primitives";

/**
 * Bucket label used for cron sessions whose id doesn't parse into a
 * recognizable ``cron_{jobId}_{ts}`` form. Realistically empty in normal
 * operation, but kept as an explicit constant so the orphan section is
 * grouped consistently rather than each row turning into its own section.
 */
const CRON_ORPHAN_SOURCE = "__cron_orphan__";

/** Format a Hermes cron-run trigger timestamp into a row / title string. */
function formatRunTitle(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ScheduledRuns {
  /** Cron sessions as SessionMeta, keyed by jobId in `source`. */
  runs: SessionMeta[];
  ready: boolean;
  refresh: () => void | Promise<void>;
  /** Section label: job name, or the "scheduled" group label for orphans. */
  labelFor: (source: string) => string;
  /** Per-section "run now" action, or null for orphan sections. */
  actionsFor: (source: string) => ReactNode;
  /** Top-bar title for an open run: "{job} · {time}" | "{time}" | null. */
  activeRunTitle: (activeId: string) => string | null;
}

export function useScheduledRuns(): ScheduledRuns {
  const { t } = useT();
  const cronSessions = useCronSessions();

  // Cron job id → display name. Populated once on mount from the cron jobs
  // API; used to label each section with the job's human-readable name.
  const [cronJobNames, setCronJobNames] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await getHermesCronJobs();
      if (cancelled || !r.ok) return;
      const m = new Map<string, string>();
      for (const j of r.jobs) m.set(j.id, j.name || j.id);
      setCronJobNames(m);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runs = useMemo<SessionMeta[]>(
    () =>
      cronSessions.sessions.map((s) => {
        const jobId = parseCronSessionJobId(s.id) ?? CRON_ORPHAN_SOURCE;
        const startedMs = (s.started_at ?? 0) * 1000;
        const updatedMs = (s.last_active ?? s.started_at ?? 0) * 1000;
        return {
          id: s.id,
          title: formatRunTitle(startedMs),
          createdAt: startedMs,
          updatedAt: updatedMs,
          messageCount: s.message_count ?? 0,
          source: jobId,
        };
      }),
    [cronSessions.sessions],
  );

  const labelFor = useCallback(
    (src: string): string => {
      if (src === CRON_ORPHAN_SOURCE) {
        return t("sidepanel.sessions.group.scheduled");
      }
      return cronJobNames.get(src) ?? src;
    },
    [cronJobNames, t],
  );

  const actionsFor = useCallback(
    (src: string): ReactNode => {
      if (src === CRON_ORPHAN_SOURCE) return null;
      const displayName = cronJobNames.get(src) ?? src;
      return <CronTriggerButton jobId={src} jobName={displayName} />;
    },
    [cronJobNames],
  );

  const activeRunTitle = useCallback(
    (activeId: string): string | null => {
      if (!activeId) return null;
      const meta = runs.find((s) => s.id === activeId);
      if (!meta) return null;
      const jobId = meta.source;
      const jobName =
        jobId && jobId !== CRON_ORPHAN_SOURCE
          ? cronJobNames.get(jobId)
          : undefined;
      return jobName ? `${jobName} · ${meta.title}` : meta.title;
    },
    [runs, cronJobNames],
  );

  return {
    runs,
    ready: cronSessions.ready,
    refresh: cronSessions.refresh,
    labelFor,
    actionsFor,
    activeRunTitle,
  };
}

/**
 * Hover-revealed "Run this cron job now" affordance for each Scheduled
 * section. Click → native `confirm()` (matches `ScheduledTasksPage`), then
 * `triggerHermesCronJob(jobId)`; the run lands on the next scheduler tick
 * and shows up under the section like any other.
 */
function CronTriggerButton({
  jobId,
  jobName,
}: {
  jobId: string;
  jobName: string;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (busy) return;
    const ok = window.confirm(
      t("sidepanel.sessions.scheduled.triggerConfirm", { name: jobName }),
    );
    if (!ok) return;
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const r = await triggerHermesCronJob(jobId);
        if (!r.ok) {
          setError(r.error ?? "Trigger failed");
          window.alert(
            t("sidepanel.sessions.scheduled.triggerFailed", {
              error: r.error ?? "Trigger failed",
            }),
          );
        }
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        setError(msg);
        window.alert(
          t("sidepanel.sessions.scheduled.triggerFailed", { error: msg }),
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={(e) => e.stopPropagation()}
      disabled={busy}
      aria-label={t("sidepanel.sessions.scheduled.trigger")}
      title={
        error
          ? t("sidepanel.sessions.scheduled.triggerFailed", { error })
          : t("sidepanel.sessions.scheduled.trigger")
      }
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
        busy && "cursor-wait opacity-60",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Zap className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
