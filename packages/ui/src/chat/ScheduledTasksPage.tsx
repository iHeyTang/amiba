import {
  CalendarClock,
  CircleAlert,
  Copy,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "../primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../primitives";
import { Input } from "../primitives";
import { Label } from "../primitives";
import { ScrollArea } from "../primitives";
import { Switch } from "../primitives";
import { Textarea } from "../primitives";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../primitives";
import {
  createHermesCronJob,
  deleteHermesCronJob,
  getHermesCronJobs,
  pauseHermesCronJob,
  resumeHermesCronJob,
  triggerHermesCronJob,
  updateHermesCronJob,
  type HermesCronCreateInput,
  type HermesCronJob,
  type HermesCronUpdateInput,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { cn } from "../primitives";
import { SettingsPaneHeader } from "../settings/SettingsPaneHeader";

type Language = "en" | "zh-CN";

function formatAbsolute(
  iso: string | null | undefined,
  language: Language,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(language === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(
  iso: string | null | undefined,
  language: Language,
): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(
    language === "zh-CN" ? "zh-CN" : "en-US",
    { numeric: "auto" },
  );
  if (abs < 60_000) {
    return rtf.format(Math.round(diff / 1_000), "second");
  }
  if (abs < 3_600_000) {
    return rtf.format(Math.round(diff / 60_000), "minute");
  }
  if (abs < 86_400_000) {
    return rtf.format(Math.round(diff / 3_600_000), "hour");
  }
  if (abs < 2_592_000_000) {
    return rtf.format(Math.round(diff / 86_400_000), "day");
  }
  if (abs < 31_536_000_000) {
    return rtf.format(Math.round(diff / 2_592_000_000), "month");
  }
  return rtf.format(Math.round(diff / 31_536_000_000), "year");
}

function padTimePart(value: string): string {
  return value.padStart(2, "0");
}

function humanizeSchedule(raw: string, language: Language): string {
  const schedule = raw.trim();
  const daily = schedule.match(
    /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\*|1-5|1,2,3,4,5)$/,
  );
  if (daily) {
    const time = `${padTimePart(daily[2])}:${padTimePart(daily[1])}`;
    const weekdays = daily[3] !== "*";
    if (language === "zh-CN") {
      return `${weekdays ? "工作日" : "每天"} ${time}`;
    }
    return `${weekdays ? "Weekdays" : "Daily"} at ${time}`;
  }

  const minuteStep = schedule.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (minuteStep) {
    return language === "zh-CN"
      ? `每 ${minuteStep[1]} 分钟`
      : `Every ${minuteStep[1]} minutes`;
  }

  const interval = schedule.match(/^every\s+(\d+)\s*([mhd])$/i);
  if (interval) {
    const amount = interval[1];
    const unit = interval[2].toLowerCase();
    if (language === "zh-CN") {
      const unitLabel = unit === "m" ? "分钟" : unit === "h" ? "小时" : "天";
      return `每 ${amount} ${unitLabel}`;
    }
    const unitLabel =
      unit === "m" ? "minutes" : unit === "h" ? "hours" : "days";
    return `Every ${amount} ${unitLabel}`;
  }

  return schedule || "—";
}

function taskSummary(prompt: string | null | undefined): string {
  return (
    prompt
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

interface JobFormState {
  name: string;
  prompt: string;
  schedule: string;
  // `deliver` is intentionally NOT on the form. New jobs created from
  // this page have no chat origin, so Hermes core defaults `deliver` to
  // `"local"` (= no channel push, file-only — the new-tab page reads
  // those files via the bridge). Updates from this form never send
  // `deliver`, so a value the user set via conversation (e.g. `"feishu"`)
  // is preserved. To configure delivery, ask Hermes — the upstream
  // `cronjob` tool's `action=update` accepts any deliver token.
  noAgent: boolean;
  script: string;
  repeat: string;
  skills: string;
  model: string;
  workdir: string;
}

function emptyForm(): JobFormState {
  return {
    name: "",
    prompt: "",
    schedule: "",
    noAgent: false,
    script: "",
    repeat: "",
    skills: "",
    model: "",
    workdir: "",
  };
}

function jobToForm(job: HermesCronJob): JobFormState {
  return {
    name: job.name ?? "",
    prompt: job.prompt ?? "",
    schedule: job.schedule_display ?? job.schedule?.display ?? "",
    noAgent: !!job.no_agent,
    script: job.script ?? "",
    repeat: job.repeat?.times != null ? String(job.repeat.times) : "",
    skills: (job.skills ?? []).join(", "),
    model: job.model ?? "",
    workdir: job.workdir ?? "",
  };
}

function buildCreateInput(form: JobFormState): HermesCronCreateInput | string {
  const schedule = form.schedule.trim();
  if (!schedule) return "Schedule is required";

  const prompt = form.prompt.trim();
  const noAgent = form.noAgent;
  const script = form.script.trim() || undefined;

  if (noAgent && !script) {
    return "no_agent mode requires a script";
  }
  if (!noAgent && !prompt) {
    return "Prompt is required (unless no_agent mode is enabled)";
  }

  const skillsList = form.skills
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const repeatRaw = form.repeat.trim();
  let repeat: number | undefined;
  if (repeatRaw) {
    const n = Number(repeatRaw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return "Repeat must be 0 or a positive integer";
    }
    repeat = n;
  }

  // Note: `deliver` is intentionally omitted. Hermes core will default it
  // — for a job created without an `origin` (which is always the case
  // from this options page), the default is `"local"` (no channel push,
  // file-only — the new-tab page reads those files). Users who want
  // channel push set it via chat.
  const input: HermesCronCreateInput = {
    schedule,
    no_agent: noAgent,
  };
  if (prompt) input.prompt = prompt;
  if (form.name.trim()) input.name = form.name.trim();
  if (script) input.script = script;
  if (skillsList.length) input.skills = skillsList;
  if (form.model.trim()) input.model = form.model.trim();
  if (form.workdir.trim()) input.workdir = form.workdir.trim();
  if (repeat != null) input.repeat = repeat;

  return input;
}

function buildUpdateInput(form: JobFormState): HermesCronUpdateInput | string {
  const created = buildCreateInput(form);
  if (typeof created === "string") return created;
  // `deliver` is deliberately not sent — the bridge's `update_job_response`
  // only patches fields present in the payload, so a value the user has
  // configured via chat (e.g. `"feishu"`, `"all"`, …) is preserved
  // through an options-page edit.
  const update: HermesCronUpdateInput = {
    schedule: created.schedule,
    no_agent: created.no_agent,
    name: created.name ?? "",
    prompt: created.prompt ?? "",
    skills: created.skills ?? [],
    model: created.model ?? null,
    script: created.script ?? null,
    workdir: created.workdir ?? null,
  };
  if (typeof created.repeat === "number") {
    update.repeat = created.repeat;
  }
  return update;
}

interface JobDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initial: JobFormState;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (form: JobFormState) => Promise<void>;
}

function JobDialog({
  open,
  mode,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: JobDialogProps) {
  const [form, setForm] = useState<JobFormState>(initial);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      // Open the advanced panel automatically if any advanced field is set,
      // so editing an existing job doesn't hide non-default values.
      setAdvancedOpen(
        !!(
          initial.skills ||
          initial.model ||
          initial.workdir ||
          initial.repeat ||
          initial.noAgent ||
          initial.script
        ),
      );
    }
  }, [open, initial]);

  function patch<K extends keyof JobFormState>(key: K, value: JobFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[90vw] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border bg-muted/30 px-4 py-3">
          <DialogTitle className="text-sm font-semibold">
            {mode === "create" ? "Create cron job" : "Edit cron job"}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Stored in ~/.hermes/cron/jobs.json and executed by Hermes Agent
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="cron-name" className="text-xs">
                Name
              </Label>
              <Input
                id="cron-name"
                value={form.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder="(optional; defaults to the first 50 chars of the prompt)"
                className="h-8 text-xs"
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cron-schedule" className="text-xs">
                Schedule <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cron-schedule"
                value={form.schedule}
                onChange={(e) => patch("schedule", e.target.value)}
                placeholder="0 9 * * *  /  every 30m  /  30m  /  2026-02-03T14:00"
                className="h-8 font-mono text-xs"
                disabled={busy}
              />
              <p className="text-[10px] text-muted-foreground">
                Accepts: 5-field cron expression · "every 30m / 2h / 1d" ·
                duration "30m / 2h / 1d" (one-shot) · ISO timestamp
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cron-prompt" className="text-xs">
                Prompt{" "}
                {form.noAgent ? (
                  ""
                ) : (
                  <span className="text-destructive">*</span>
                )}
              </Label>
              <Textarea
                id="cron-prompt"
                value={form.prompt}
                onChange={(e) => patch("prompt", e.target.value)}
                placeholder={
                  form.noAgent
                    ? "(optional in no_agent mode; used only as a name hint)"
                    : "Instructions Hermes Agent will run. Must be self-contained (no session context)."
                }
                className="min-h-[120px] font-mono text-xs"
                disabled={busy}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {advancedOpen ? "Hide advanced" : "Show advanced"}
              </button>
            </div>

            {advancedOpen && (
              <div className="space-y-3 rounded border border-border/60 bg-muted/10 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">no_agent mode</p>
                    <p className="text-[10px] text-muted-foreground">
                      Run the script directly without the LLM; empty stdout is
                      silent.
                    </p>
                  </div>
                  <Switch
                    checked={form.noAgent}
                    onCheckedChange={(v) => patch("noAgent", v)}
                    disabled={busy}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cron-script" className="text-xs">
                    Script
                  </Label>
                  <Input
                    id="cron-script"
                    value={form.script}
                    onChange={(e) => patch("script", e.target.value)}
                    placeholder="Resolved under ~/.hermes/scripts/; absolute paths also accepted"
                    className="h-8 font-mono text-xs"
                    disabled={busy}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cron-repeat" className="text-xs">
                      Repeat count
                    </Label>
                    <Input
                      id="cron-repeat"
                      type="number"
                      min={0}
                      value={form.repeat}
                      onChange={(e) => patch("repeat", e.target.value)}
                      placeholder="Leave blank = unlimited"
                      className="h-8 text-xs"
                      disabled={busy}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cron-model" className="text-xs">
                      Model override
                    </Label>
                    <Input
                      id="cron-model"
                      value={form.model}
                      onChange={(e) => patch("model", e.target.value)}
                      placeholder="e.g. claude-opus-4-7"
                      className="h-8 font-mono text-xs"
                      disabled={busy}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cron-skills" className="text-xs">
                    Skills (comma-separated)
                  </Label>
                  <Input
                    id="cron-skills"
                    value={form.skills}
                    onChange={(e) => patch("skills", e.target.value)}
                    placeholder="lark-mail, lark-calendar"
                    className="h-8 font-mono text-xs"
                    disabled={busy}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cron-workdir" className="text-xs">
                    Working directory
                  </Label>
                  <Input
                    id="cron-workdir"
                    value={form.workdir}
                    onChange={(e) => patch("workdir", e.target.value)}
                    placeholder="Absolute path; blank = scheduler cwd"
                    className="h-8 font-mono text-xs"
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border bg-muted/20 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void onSubmit(form)}>
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface JobRowProps {
  job: HermesCronJob;
  busy: boolean;
  onPause: (job: HermesCronJob) => void;
  onResume: (job: HermesCronJob) => void;
  onTrigger: (job: HermesCronJob) => void;
  onEdit: (job: HermesCronJob) => void;
  onCopyId: (job: HermesCronJob) => void;
  onDelete: (job: HermesCronJob) => void;
}

function JobRow({
  job,
  busy,
  onPause,
  onResume,
  onTrigger,
  onEdit,
  onCopyId,
  onDelete,
}: JobRowProps) {
  const { t, language } = useT();
  const paused = job.state === "paused" || !job.enabled;
  const completed = job.state === "completed";
  const issue = job.last_error || job.last_delivery_error;
  const nextRun =
    formatRelative(job.next_run_at, language) ||
    formatAbsolute(job.next_run_at, language);
  const lastRun =
    formatRelative(job.last_run_at, language) ||
    formatAbsolute(job.last_run_at, language);
  const scheduleLabel = humanizeSchedule(job.schedule_display, language);
  const summary =
    taskSummary(job.prompt) ||
    (job.script
      ? t("options.cron.row.script", { script: job.script })
      : t("options.cron.row.noDescription"));
  const stateLabel =
    job.state === "scheduled"
      ? t("options.cron.state.scheduled")
      : job.state === "running"
        ? t("options.cron.state.running")
        : job.state === "paused"
          ? t("options.cron.state.paused")
          : job.state === "completed"
            ? t("options.cron.state.completed")
            : job.state === "error"
              ? t("options.cron.state.error")
              : t("options.cron.state.unknown");
  const statusDotClass =
    job.state === "running"
      ? "bg-sky-500 motion-safe:animate-pulse"
      : job.state === "error" || job.last_status === "error"
        ? "bg-destructive"
        : paused
          ? "bg-muted-foreground/45"
          : completed
            ? "bg-violet-500/70"
            : "bg-emerald-500";
  const lastRunLabel = !job.last_run_at
    ? t("options.cron.meta.neverRun")
    : job.last_status === "error"
      ? t("options.cron.meta.lastFailed", { time: lastRun })
      : job.last_status === "ok"
        ? t("options.cron.meta.lastSucceeded", { time: lastRun })
        : t("options.cron.meta.lastRun", { time: lastRun });

  return (
    <li className="group relative rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-muted/35 focus-within:bg-muted/35">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "mt-[7px] h-2 w-2 shrink-0 rounded-full ring-4 ring-background",
            statusDotClass,
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
              {job.name || job.id}
            </h3>
            <span
              className={cn(
                "shrink-0 text-[11px]",
                job.state === "error" || job.last_status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {stateLabel}
            </span>
            {job.no_agent && (
              <span
                className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                title="no_agent"
              >
                {t("options.cron.mode.directScript")}
              </span>
            )}
          </div>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default font-medium text-foreground/70">
                  {scheduleLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <code className="font-mono">{job.schedule_display}</code>
              </TooltipContent>
            </Tooltip>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span title={formatAbsolute(job.next_run_at, language)}>
              {job.next_run_at
                ? t("options.cron.meta.nextRun", { time: nextRun })
                : t("options.cron.meta.noNextRun")}
            </span>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span
              className={cn(job.last_status === "error" && "text-destructive")}
              title={formatAbsolute(job.last_run_at, language)}
            >
              {lastRunLabel}
            </span>
          </div>

          <p
            className="mt-1.5 truncate text-xs leading-5 text-muted-foreground/80"
            title={summary}
          >
            {summary}
          </p>

          {issue && (
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-destructive">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{issue}</span>
            </div>
          )}
        </div>

        <div className="flex h-8 shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-events-none h-8 gap-1.5 px-2.5 text-xs opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            disabled={busy}
            onClick={() => onTrigger(job)}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {t("options.cron.action.runNow")}
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Switch
                  checked={!paused && !completed}
                  disabled={busy || completed}
                  onCheckedChange={(checked) =>
                    checked ? onResume(job) : onPause(job)
                  }
                  aria-label={
                    paused
                      ? t("options.cron.action.resumeNamed", {
                          name: job.name || job.id,
                        })
                      : t("options.cron.action.pauseNamed", {
                          name: job.name || job.id,
                        })
                  }
                  className="scale-90 shadow-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-offset-1"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {completed
                ? t("options.cron.state.completed")
                : paused
                  ? t("options.cron.action.resume")
                  : t("options.cron.action.pause")}
            </TooltipContent>
          </Tooltip>

          <TaskActionsMenu
            job={job}
            busy={busy}
            onTrigger={() => onTrigger(job)}
            onEdit={() => onEdit(job)}
            onCopyId={() => onCopyId(job)}
            onDelete={() => onDelete(job)}
          />
        </div>
      </div>
    </li>
  );
}

interface TaskActionsMenuProps {
  job: HermesCronJob;
  busy: boolean;
  onTrigger: () => void;
  onEdit: () => void;
  onCopyId: () => void;
  onDelete: () => void;
}

function TaskActionsMenu({
  job,
  busy,
  onTrigger,
  onEdit,
  onCopyId,
  onDelete,
}: TaskActionsMenuProps) {
  const { t } = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 208;
    const height = 176;
    const spaceBelow = window.innerHeight - rect.bottom;
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.right - width, window.innerWidth - width - 8),
      ),
      top:
        spaceBelow >= height + 8
          ? rect.bottom + 6
          : Math.max(8, rect.top - height - 6),
    });
    setOpen(true);
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const onWindowChange = () => closeMenu();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);
    const focusTimer = window.setTimeout(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [closeMenu, open]);

  const runAndClose = (action: () => void) => {
    closeMenu();
    action();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground"
        disabled={busy}
        aria-label={t("options.cron.action.moreNamed", {
          name: job.name || job.id,
        })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("options.cron.action.menu")}
            onKeyDown={onMenuKeyDown}
            className="fixed z-50 w-52 rounded-lg border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-popover"
            style={position}
          >
            <TaskMenuItem
              icon={<Zap />}
              label={t("options.cron.action.runNow")}
              onClick={() => runAndClose(onTrigger)}
            />
            <TaskMenuItem
              icon={<Pencil />}
              label={t("options.cron.action.edit")}
              onClick={() => runAndClose(onEdit)}
            />
            <TaskMenuItem
              icon={<Copy />}
              label={t("options.cron.action.copyId")}
              onClick={() => runAndClose(onCopyId)}
            />
            <div className="my-1 h-px bg-border/50" />
            <TaskMenuItem
              destructive
              icon={<Trash2 />}
              label={t("options.cron.action.delete")}
              onClick={() => runAndClose(onDelete)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function TaskMenuItem({
  icon,
  label,
  destructive = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors focus:bg-accent hover:bg-accent",
        destructive
          ? "text-destructive focus:text-destructive hover:text-destructive"
          : "text-foreground",
      )}
    >
      <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function ScheduledTasksPage() {
  const { t } = useT();
  const [jobs, setJobs] = useState<HermesCronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  // Single-flight per-job lock for lifecycle actions. Lets each row spin its
  // own buttons without blocking the table; matches what SettingsSkills does.
  const [busyJobIds, setBusyJobIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<HermesCronJob | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await getHermesCronJobs();
    setLoading(false);
    if (!r.ok) {
      setError(r.error || "Failed to load");
      setJobs([]);
      return;
    }
    setJobs(r.jobs);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  const markBusy = useCallback((id: string, on: boolean) => {
    setBusyJobIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const runAction = useCallback(
    async (
      job: HermesCronJob,
      op: () => Promise<{ ok: boolean; error?: string; job?: HermesCronJob }>,
    ) => {
      markBusy(job.id, true);
      setActionError(null);
      const r = await op();
      markBusy(job.id, false);
      if (!r.ok) {
        setActionError(`${job.name || job.id}: ${r.error || "Action failed"}`);
        return;
      }
      if (r.job) {
        setJobs((prev) => prev.map((j) => (j.id === r.job!.id ? r.job! : j)));
      } else {
        void refresh();
      }
    },
    [markBusy, refresh],
  );

  const handlePause = useCallback(
    (job: HermesCronJob) =>
      void runAction(job, () => pauseHermesCronJob(job.id)),
    [runAction],
  );
  const handleResume = useCallback(
    (job: HermesCronJob) =>
      void runAction(job, () => resumeHermesCronJob(job.id)),
    [runAction],
  );
  const handleTrigger = useCallback(
    (job: HermesCronJob) =>
      void runAction(job, () => triggerHermesCronJob(job.id)),
    [runAction],
  );

  const handleDelete = useCallback(
    (job: HermesCronJob) => {
      if (
        !confirm(
          t("options.cron.action.deleteConfirm", {
            name: job.name || job.id,
          }),
        )
      ) {
        return;
      }
      markBusy(job.id, true);
      setActionError(null);
      void deleteHermesCronJob(job.id).then((r) => {
        markBusy(job.id, false);
        if (!r.ok) {
          setActionError(
            `${job.name || job.id}: ${r.error || "Delete failed"}`,
          );
          return;
        }
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
      });
    },
    [markBusy, t],
  );

  const handleCopyId = useCallback(
    async (job: HermesCronJob) => {
      try {
        await navigator.clipboard.writeText(job.id);
        setActionError(null);
        setNotice(t("options.cron.action.copied"));
        if (noticeTimerRef.current != null) {
          window.clearTimeout(noticeTimerRef.current);
        }
        noticeTimerRef.current = window.setTimeout(() => {
          setNotice(null);
          noticeTimerRef.current = null;
        }, 2_000);
      } catch {
        setNotice(null);
        setActionError(t("options.cron.action.copyFailed"));
      }
    },
    [t],
  );

  const handleSubmit = useCallback(
    async (form: JobFormState) => {
      setFormError(null);
      if (editing) {
        const update = buildUpdateInput(form);
        if (typeof update === "string") {
          setFormError(update);
          return;
        }
        setFormBusy(true);
        const r = await updateHermesCronJob(editing.id, update);
        setFormBusy(false);
        if (!r.ok) {
          setFormError(r.error || "Save failed");
          return;
        }
        if (r.job) {
          setJobs((prev) => prev.map((j) => (j.id === r.job!.id ? r.job! : j)));
        }
        setEditing(null);
      } else {
        const input = buildCreateInput(form);
        if (typeof input === "string") {
          setFormError(input);
          return;
        }
        setFormBusy(true);
        const r = await createHermesCronJob(input);
        setFormBusy(false);
        if (!r.ok) {
          setFormError(r.error || "Create failed");
          return;
        }
        if (r.job) {
          setJobs((prev) => [...prev, r.job!]);
        }
        setCreating(false);
      }
    },
    [editing],
  );

  const initialForm = useMemo<JobFormState>(
    () => (editing ? jobToForm(editing) : emptyForm()),
    [editing],
  );

  const dialogOpen = creating || editing != null;

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <SettingsPaneHeader
          title={t("options.cron.title")}
          subtitle={t("options.cron.subtitle")}
          contentClassName="mx-auto max-w-5xl"
        >
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  disabled={loading}
                  aria-label={t("options.cron.refresh")}
                  onClick={() => void refresh()}
                >
                  <RefreshCw
                    className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("options.cron.refresh")}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("options.cron.newJob")}
            </Button>
          </div>
        </SettingsPaneHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-5xl p-6 pt-4">
            <div aria-live="polite" className="min-h-5">
              {notice && (
                <p role="status" className="text-[11px] text-muted-foreground">
                  {notice}
                </p>
              )}
            </div>

            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
            {actionError && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-destructive">
                <CircleAlert className="h-3.5 w-3.5" />
                <p>{actionError}</p>
              </div>
            )}

            {loading && jobs.length === 0 ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("options.cron.loading")}
              </div>
            ) : !error && jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <CalendarClock className="h-4 w-4" />
                </span>
                <p className="text-sm font-medium">
                  {t("options.cron.empty.title")}
                </p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  {t("options.cron.empty.description")}
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    busy={busyJobIds.has(job.id)}
                    onPause={handlePause}
                    onResume={handleResume}
                    onTrigger={handleTrigger}
                    onEdit={setEditing}
                    onCopyId={(selected) => void handleCopyId(selected)}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>

        <JobDialog
          open={dialogOpen}
          mode={editing ? "edit" : "create"}
          initial={initialForm}
          busy={formBusy}
          error={formError}
          onClose={() => {
            if (formBusy) return;
            setCreating(false);
            setEditing(null);
            setFormError(null);
          }}
          onSubmit={handleSubmit}
        />
      </div>
    </TooltipProvider>
  );
}
