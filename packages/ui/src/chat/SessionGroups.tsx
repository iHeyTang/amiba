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

import { useT } from "@amiba/i18n";
import {
  getHermesCronJobs,
  parseCronSessionJobId,
  useCronSessions,
  type HermesCronJob,
  type HermesSession,
} from "@amiba/core";
import { cn } from "../primitives";
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
  /**
   * Optional buttons rendered at the right edge of the section header,
   * visible only on hover. Used for per-group affordances like "trigger
   * this cron job now". Each action MUST `stopPropagation` on its own
   * click handler so it doesn't bubble up and toggle the section.
   */
  actions?: ReactNode;
}

export function TopSection({
  label,
  count,
  collapsed,
  onToggle,
  children,
  variant = "drawer",
  flex = false,
  actions,
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
  // Header is a `<div>` (not a button) because `actions` may contain
  // nested buttons, and `<button>` inside `<button>` is invalid HTML.
  // The clickable chevron+label area is its own inner button.
  const header = (
    <div
      className={cn(
        "group/topsection relative flex w-full shrink-0 items-center font-semibold uppercase tracking-wider text-muted-foreground hover:bg-accent/40",
        headerCls,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="flex-1 truncate">{label}</span>
      </button>
      {typeof count === "number" && count > 0 && (
        // Right-edge count. Rendered in natural text height (no h-6
        // box) so the section header reads at its tighter ~26px row
        // and doesn't visibly jump shorter when the hover action slot
        // takes over — the action button is absolute-positioned and
        // doesn't expand the parent, so a h-6 count would have made
        // the row jitter on every hover.
        <span
          className={cn(
            "pr-1 text-[10px] font-normal normal-case tabular-nums text-muted-foreground/70",
            actions && "group-hover/topsection:invisible",
          )}
        >
          {count}
        </span>
      )}
      {actions && (
        // Absolutely positioned so its height (h-6 icon button) doesn't
        // push the wrapper taller — the row stays at text height in
        // both states. We use `invisible` (not `hidden`) on the count
        // above so the layout slot is reserved; the actions then
        // overlay that slot without any reflow.
        <span className="absolute right-1 hidden h-6 items-center gap-0.5 group-hover/topsection:flex">
          {actions}
        </span>
      )}
    </div>
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
  /**
   * Open a cron-source session as a tab in the chat surface. The session
   * row already exists in SessionDB (we list them directly), so the
   * caller just needs to ``sessions.openTab(id)`` — no synthesis needed.
   */
  onOpenCronSession: (sessionId: string) => void;
  variant?: "drawer" | "rail";
  /** Forwarded to the inner `TopSection`. See its prop for semantics. */
  flex?: boolean;
}

export function ScheduledSection({
  open,
  collapsed,
  onToggle,
  activeId,
  onOpenCronSession,
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

  // Pull cron-source sessions straight from SessionDB. Equivalent to
  // ``hermes sessions list --source cron`` in the CLI — single canonical
  // dataset, no parallel md-file index.
  const cronSessions = useCronSessions();

  const sessionsByJob = useMemo(() => {
    const m = new Map<string, HermesSession[]>();
    for (const s of cronSessions.sessions) {
      const jobId = parseCronSessionJobId(s.id);
      if (!jobId) continue;
      const arr = m.get(jobId) ?? [];
      arr.push(s);
      m.set(jobId, arr);
    }
    return m;
  }, [cronSessions.sessions]);

  // Show all jobs that EITHER are configured (in the jobs list) OR have
  // emitted sessions in SessionDB. The session feed survives even after
  // a job has been deleted from cron config — letting the user reopen
  // historical runs is the whole point of this section.
  const orderedJobIds = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const j of jobs) {
      out.push(j.id);
      seen.add(j.id);
    }
    for (const jobId of sessionsByJob.keys()) {
      if (!seen.has(jobId)) {
        out.push(jobId);
        seen.add(jobId);
      }
    }
    return out;
  }, [jobs, sessionsByJob]);

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
      {!jobsLoaded && !cronSessions.ready ? (
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
              jobs.find((j) => j.id === jobId) ?? jobStubFromId(jobId);
            const jobSessions = sessionsByJob.get(jobId) ?? [];
            const expanded = !!jobExpanded[jobId];
            return (
              <Fragment key={jobId}>
                <CronJobRow
                  job={job}
                  runCount={jobSessions.length}
                  expanded={expanded}
                  onToggle={() => toggleJob(jobId)}
                />
                {expanded &&
                  jobSessions.map((s) => (
                    <CronRunRow
                      key={s.id}
                      session={s}
                      active={s.id === activeId}
                      onClick={() => onOpenCronSession(s.id)}
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

/**
 * Stub job descriptor for jobs that have sessions in SessionDB but no
 * matching live config (deleted ``cron remove``-style or pre-migration
 * holdovers). Just enough fields so ``CronJobRow`` can render.
 */
function jobStubFromId(jobId: string): HermesCronJob {
  return {
    id: jobId,
    name: jobId,
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
    repeat: { times: null, completed: 0 },
    enabled: false,
    state: "completed",
    paused_at: null,
    paused_reason: null,
    created_at: "",
    next_run_at: null,
    last_run_at: null,
    last_status: null,
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
        {/* Run-count badge — same 24×24 right-edge slot as every
            other count/time/icon along the rail's right margin so the
            entire right column stays visually aligned. */}
        <span className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center text-[10px] text-muted-foreground/70">
          {runCount}
        </span>
      </button>
    </li>
  );
}

interface CronRunRowProps {
  session: HermesSession;
  active: boolean;
  onClick: () => void;
}

function CronRunRow({ session, active, onClick }: CronRunRowProps) {
  // SessionDB doesn't carry an explicit "ok/error" verdict per row, so
  // the dot is just a neutral marker here. Real status info — when
  // present — lives at the job level (``last_status`` on
  // ``HermesCronJob``), so the parent ``CronJobRow``'s coloured dot
  // already conveys the canonical "last run succeeded / failed" hint.
  const startedAtMs = (session.last_active ?? session.started_at) * 1000;
  const stamp = new Date(startedAtMs).toLocaleString(undefined, {
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
          // job's dot. The invisible chevron-sized spacer replaces
          // the parent's ChevronRight glyph, giving the row a
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
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
        />
        <span className="min-w-0 flex-1 truncate">{stamp}</span>
      </button>
    </li>
  );
}
