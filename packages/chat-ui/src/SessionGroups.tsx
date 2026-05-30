/**
 * Shared building blocks for the "chats + scheduled tasks" sidebar
 * layout. Used by both `SessionDrawer` (the slim Cursor-style overlay
 * in the side panel) and `SessionsRail` (the always-visible rail in
 * `FullScreenChatView`). Keeping them here avoids duplicating the cron
 * data fetch + per-job expansion state across two surfaces that have
 * identical needs.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import { useT } from "@hermes-x/i18n";
import {
  cronRunKey,
  getHermesCronJobs,
  useCronRuns,
  type CronRun,
  type HermesCronJob,
} from "@hermes-x/core";
import { cn } from "@hermes-x/utils";

/* ─────────────────────────── Top-level section header */

export interface TopSectionProps {
  label: string;
  /** Optional pill next to the label (e.g. session count). */
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Adjust the section header to match the host's text scale. */
  variant?: "drawer" | "rail";
  /**
   * When true, render as a flex item: the wrapper claims ``flex-1`` when
   * expanded (so it shares vertical space with sibling sections and the
   * body scrolls internally) and ``shrink-0`` when collapsed (so the
   * header still pins in place, VSCode-style). The parent must be a
   * flex column with ``min-h-0`` set. When false (default), the section
   * renders in natural content height — appropriate for hosts that
   * place all sections inside a single outer scroll container.
   */
  flex?: boolean;
}

export function TopSection({
  label,
  count,
  collapsed,
  onToggle,
  children,
  variant = "drawer",
  flex = false,
}: TopSectionProps) {
  // Top-level sections have a bottom border so adjacent ones share a
  // single visual divider when stacked (no gap between siblings → the
  // upper section's bottom-border IS the lower section's top-border).
  // The rail container adds a single ``border-t`` to crown the very
  // first section.
  const headerCls =
    variant === "rail"
      ? "px-3 py-1.5 text-[10px]"
      : "px-2 py-1.5 text-xs";
  const header = (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full shrink-0 items-center gap-1.5 text-left font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40",
        headerCls,
      )}
      aria-expanded={!collapsed}
    >
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && count > 0 && (
        <span className="text-[10px] font-normal normal-case text-muted-foreground/70">
          {count}
        </span>
      )}
    </button>
  );

  if (flex) {
    return (
      <section
        className={cn(
          "flex min-h-0 flex-col border-b border-border/60",
          collapsed ? "shrink-0" : "flex-1",
        )}
      >
        {header}
        {!collapsed && (
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        )}
      </section>
    );
  }
  return (
    <section className="border-b border-border/60">
      {header}
      {!collapsed && <div>{children}</div>}
    </section>
  );
}

/* ─────────────────────────── Scheduled-tasks section */

export interface ScheduledSectionProps {
  /** Drawer/rail is visible AND this section is expanded. Drives fetches. */
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
  activeId: string;
  onOpenCronRun: (job: HermesCronJob, run: CronRun) => void;
  variant?: "drawer" | "rail";
  /** Forwarded to the inner `TopSection`. See its prop for semantics. */
  flex?: boolean;
}

export function ScheduledSection({
  open,
  collapsed,
  onToggle,
  activeId,
  onOpenCronRun,
  variant = "drawer",
  flex = false,
}: ScheduledSectionProps) {
  const { t } = useT();
  const [jobs, setJobs] = useState<HermesCronJob[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // Lazy-fetch cron jobs the first time this section becomes visible.
  // Re-fetch on subsequent expansions too — the user may have created /
  // deleted jobs from another surface and we don't have a push channel.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const res = await getHermesCronJobs();
      if (cancelled) return;
      if (res.ok) {
        setJobs(res.jobs);
        setJobsError(null);
      } else {
        setJobsError(res.error || "failed");
      }
      setJobsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const cronRuns = useCronRuns();

  const runsByJob = useMemo(() => {
    const m = new Map<string, CronRun[]>();
    for (const r of cronRuns.runs) {
      const arr = m.get(r.jobId) ?? [];
      arr.push(r);
      m.set(r.jobId, arr);
    }
    return m;
  }, [cronRuns.runs]);

  // Show all jobs that EITHER are configured (in the jobs list) OR have
  // emitted runs in the recent window. The runs feed survives even after
  // a job has been deleted from cron config — letting the user reopen a
  // historical run as a chat is the whole point of this section.
  const orderedJobIds = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const j of jobs) {
      out.push(j.id);
      seen.add(j.id);
    }
    for (const r of cronRuns.runs) {
      if (!seen.has(r.jobId)) {
        out.push(r.jobId);
        seen.add(r.jobId);
      }
    }
    return out;
  }, [jobs, cronRuns.runs]);

  const visibleCount = orderedJobIds.length;

  // Per-job expand state. Defaults to collapsed.
  const [jobExpanded, setJobExpanded] = useState<Record<string, boolean>>({});
  const toggleJob = (id: string) =>
    setJobExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <TopSection
      label={t("sidepanel.sessions.group.scheduled")}
      count={visibleCount}
      collapsed={collapsed}
      onToggle={onToggle}
      variant={variant}
      flex={flex}
    >
      {!jobsLoaded && !cronRuns.ready ? (
        <div className="mx-3 my-2 rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          {t("sidepanel.sessions.scheduled.loading")}
        </div>
      ) : visibleCount === 0 ? (
        <div className="mx-3 my-2 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {jobsError
            ? t("sidepanel.sessions.scheduled.error")
            : t("sidepanel.sessions.scheduled.empty")}
        </div>
      ) : (
        // Flat list — job rows and their (expanded) run rows are
        // siblings, not nested. That way the active/hover background
        // can span the rail edge-to-edge for both levels; visual
        // hierarchy is provided by the deeper left-padding on run
        // rows rather than a nested ``<ul>`` indent.
        <ul>
          {orderedJobIds.map((jobId) => {
            const job =
              jobs.find((j) => j.id === jobId) ??
              jobFromRuns(jobId, runsByJob.get(jobId) ?? []);
            const runs = runsByJob.get(jobId) ?? [];
            const expanded = !!jobExpanded[jobId];
            return (
              <Fragment key={jobId}>
                <CronJobRow
                  job={job}
                  runCount={runs.length}
                  expanded={expanded}
                  onToggle={() => toggleJob(jobId)}
                />
                {expanded &&
                  runs.map((r) => (
                    <CronRunRow
                      key={cronRunKey(r)}
                      run={r}
                      active={
                        syntheticIdForRun(job.id, r.runId) === activeId
                      }
                      onClick={() => onOpenCronRun(job, r)}
                    />
                  ))}
              </Fragment>
            );
          })}
        </ul>
      )}
    </TopSection>
  );
}

/** Synthesize a minimal job stub when only runs (no live config) are known. */
function jobFromRuns(jobId: string, runs: CronRun[]): HermesCronJob {
  const name = runs[0]?.jobName || jobId;
  return {
    id: jobId,
    name,
    prompt: "",
    skills: [],
    skill: null,
    model: null,
    provider: null,
    base_url: null,
    script: null,
    no_agent: false,
    context_from: null,
    schedule: { kind: "cron" },
    schedule_display: "",
    repeat: { times: null, completed: runs.length },
    enabled: false,
    state: "completed",
    paused_at: null,
    paused_reason: null,
    created_at: "",
    next_run_at: null,
    last_run_at: null,
    last_status:
      runs[0]?.status === "error"
        ? "error"
        : runs[0]?.status === "ok"
          ? "ok"
          : null,
    last_error: null,
    last_delivery_error: null,
    deliver: "local",
    origin: null,
    enabled_toolsets: null,
    workdir: null,
  };
}

/* ─────────────────────────── Cron job + run rows */

interface CronJobRowProps {
  job: HermesCronJob;
  runCount: number;
  expanded: boolean;
  onToggle: () => void;
}

function CronJobRow({ job, runCount, expanded, onToggle }: CronJobRowProps) {
  const displayName = job.name || job.id;
  const stateDot =
    job.last_status === "error"
      ? "bg-destructive"
      : job.last_status === "ok"
        ? "bg-emerald-500"
        : "bg-muted-foreground/40";

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs hover:bg-accent/60 hover:text-accent-foreground"
        title={displayName}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateDot)}
          title={job.last_status ?? ""}
        />
        <span className="min-w-0 flex-1 truncate">{displayName}</span>
        {job.schedule_display && (
          <span className="ml-2 hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
            {job.schedule_display}
          </span>
        )}
        <span className="ml-1 shrink-0 text-[10px] text-muted-foreground/70">
          {runCount}
        </span>
      </button>
    </li>
  );
}

/** Mirrors `SidePanelView.onOpenCronRun`'s id format. Kept in sync there. */
export function syntheticIdForRun(jobId: string, runId: string): string {
  return `cron_${jobId}_${runId}`;
}

interface CronRunRowProps {
  run: CronRun;
  active: boolean;
  onClick: () => void;
}

function CronRunRow({ run, active, onClick }: CronRunRowProps) {
  // Status collapses onto a single coloured dot in the gutter — that
  // dot doubles as the icon since the parent row already conveys the
  // "this is a cron run" context. ``Clock`` would be a tautology here.
  const stateDot =
    run.status === "error"
      ? "bg-destructive"
      : run.status === "ok"
        ? "bg-emerald-500"
        : "bg-muted-foreground/40";
  const stamp = new Date(run.runAtMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          // Same ``px-3 + gap-1.5`` outer geometry as ``CronJobRow``
          // so the status dot column lines up exactly under the parent
          // job's dot. The invisible chevron-sized spacer below
          // replaces the parent's ChevronRight glyph — it preserves
          // the column without drawing anything, giving the row a
          // "tucked under the parent" feel rather than its own deeper
          // indent.
          "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs",
          active
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/60 hover:text-accent-foreground",
        )}
        title={stamp}
      >
        <span aria-hidden className="h-3 w-3 shrink-0" />
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateDot)}
        />
        <span className="min-w-0 flex-1 truncate">{stamp}</span>
      </button>
    </li>
  );
}
