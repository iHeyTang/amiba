import {
  CalendarClock,
  CircleAlert,
  CirclePlay,
  Copy,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
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

import { Button } from "../primitives";
import {
  Dialog,
  DialogContent,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../primitives";
import {
  createHermesCronJob,
  deleteHermesCronJob,
  getHermesCronJobs,
  pauseHermesCronJob,
  resumeHermesCronJob,
  triggerHermesCronJob,
  updateHermesCronJob,
  getHermesSkills,
  type HermesSkillEntry,
  type HermesCronCreateInput,
  type HermesCronJob,
  type HermesCronUpdateInput,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { getPlatform } from "@amiba/platform";
import { cn } from "../primitives";
import { ModelSelectionField } from "../models";

type Language = "en" | "zh-CN";
type JobFilter = "all" | "enabled" | "paused";

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

interface JobFormState {
  name: string;
  prompt: string;
  schedule: string;
  noAgent: boolean;
  script: string;
  repeat: string;
  skills: string[];
  model: string;
  provider: string;
  workdir: string;
  deliver: string;
}

function emptyForm(): JobFormState {
  return {
    name: "",
    prompt: "",
    schedule: "",
    noAgent: false,
    script: "",
    repeat: "",
    skills: [],
    model: "",
    provider: "",
    workdir: "",
    deliver: "local",
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
    skills: job.skills ?? [],
    model: job.model ?? "",
    provider: job.provider ?? "",
    workdir: job.workdir ?? "",
    deliver: job.deliver ?? "local",
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

  const skillsList = form.skills;

  const repeatRaw = form.repeat.trim();
  let repeat: number | undefined;
  if (repeatRaw) {
    const n = Number(repeatRaw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return "Repeat must be 0 or a positive integer";
    }
    repeat = n;
  }

  const input: HermesCronCreateInput = {
    schedule,
    no_agent: noAgent,
    deliver: form.deliver.trim() || "local",
  };
  if (prompt) input.prompt = prompt;
  if (form.name.trim()) input.name = form.name.trim();
  if (script) input.script = script;
  if (skillsList.length) input.skills = skillsList;
  if (form.model.trim()) input.model = form.model.trim();
  if (form.provider.trim()) input.provider = form.provider.trim();
  if (form.workdir.trim()) input.workdir = form.workdir.trim();
  if (repeat != null) input.repeat = repeat;

  return input;
}

function buildUpdateInput(form: JobFormState): HermesCronUpdateInput | string {
  const created = buildCreateInput(form);
  if (typeof created === "string") return created;
  const update: HermesCronUpdateInput = {
    schedule: created.schedule,
    no_agent: created.no_agent,
    name: created.name ?? "",
    prompt: created.prompt ?? "",
    skills: created.skills ?? [],
    model: created.model ?? null,
    provider: created.provider ?? null,
    deliver: created.deliver ?? "local",
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

function SkillSelectionField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<HermesSkillEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const openPicker = async () => {
    setOpen(true);
    if (skills.length > 0 || loading) return;
    setLoading(true);
    const result = await getHermesSkills();
    setLoading(false);
    if (result.ok) setSkills(result.skills);
  };

  const filtered = skills.filter((skill) => {
    const needle = query.trim().toLowerCase();
    return (
      !needle ||
      `${skill.name} ${skill.description}`.toLowerCase().includes(needle)
    );
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className="h-9 w-full justify-start rounded-xl px-3 font-normal shadow-none"
        onClick={() => void openPicker()}
      >
        <span className="min-w-0 flex-1 truncate text-left text-xs">
          {value.length > 0
            ? value.join(" · ")
            : t("options.cron.form.skills.inherit")}
        </span>
        {value.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {value.length}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[70vh] flex-col gap-0 overflow-hidden p-0" size="md">
          <DialogTitle className="sr-only">
            {t("options.cron.form.skills")}
          </DialogTitle>
          <div className="border-b border-border px-4">
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-12 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              placeholder={t("options.cron.form.skills.search")}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1 p-2">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((skill) => {
                  const selected = value.includes(skill.name);
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      onClick={() =>
                        onChange(
                          selected
                            ? value.filter((name) => name !== skill.name)
                            : [...value, skill.name],
                        )
                      }
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/60",
                        selected && "bg-secondary",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1 h-3.5 w-3.5 shrink-0 rounded border",
                          selected
                            ? "border-primary bg-primary"
                            : "border-border",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium">
                          {skill.name}
                        </span>
                        {skill.description && (
                          <span className="mt-0.5 line-clamp-2 block text-[10px] leading-4 text-muted-foreground">
                            {skill.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <DialogFooter className="border-t border-border/60 px-4 py-3">
            <Button size="sm" onClick={() => setOpen(false)}>
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
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
  const { t } = useT();
  const chooseDirectory = getPlatform().workspaces?.chooseDirectory;

  useEffect(() => {
    if (open) {
      setForm(initial);
      // Open the advanced panel automatically if any advanced field is set,
      // so editing an existing job doesn't hide non-default values.
      setAdvancedOpen(
        !!(initial.repeat || initial.noAgent || initial.script),
      );
      const workspaces = getPlatform().workspaces;
      if (!initial.workdir && workspaces) {
        void workspaces.getDefaultRoot().then((root) => {
          setForm((previous) =>
            previous.workdir ? previous : { ...previous, workdir: root },
          );
        });
      }
    }
  }, [open, initial]);

  function patch<K extends keyof JobFormState>(key: K, value: JobFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0" size="lg">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-sm font-semibold">
            {mode === "create"
              ? t("options.cron.form.create")
              : t("options.cron.form.edit")}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="cron-name" className="text-xs">
                {t("options.cron.form.name")}
              </Label>
              <Input
                id="cron-name"
                value={form.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder={t("options.cron.form.name.placeholder")}
                className="text-xs"
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cron-schedule" className="text-xs">
                {t("options.cron.form.schedule")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cron-schedule"
                value={form.schedule}
                onChange={(e) => patch("schedule", e.target.value)}
                placeholder="0 9 * * *  /  every 30m  /  30m  /  2026-02-03T14:00"
                className="font-mono text-xs"
                disabled={busy}
              />
              <p className="text-[10px] text-muted-foreground">
                {t("options.cron.form.schedule.hint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cron-prompt" className="text-xs">
                {t("options.cron.form.prompt")}{" "}
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
                    ? t("options.cron.form.prompt.scriptPlaceholder")
                    : t("options.cron.form.prompt.placeholder")
                }
                className="min-h-[120px] text-xs"
                disabled={busy}
              />
            </div>

            <section className="space-y-3">
              <h3 className="text-xs font-semibold">
                {t("options.cron.form.execution")}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t("options.cron.form.model")}
                  </Label>
                  <ModelSelectionField
                    value={
                      form.model
                        ? { model: form.model, provider: form.provider }
                        : null
                    }
                    onChange={(value) =>
                      setForm((previous) => ({
                        ...previous,
                        model: value?.model ?? "",
                        provider: value?.provider ?? "",
                      }))
                    }
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {t("options.cron.form.skills")}
                  </Label>
                  <SkillSelectionField
                    value={form.skills}
                    onChange={(value) => patch("skills", value)}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cron-workdir" className="text-xs">
                  {t("options.cron.form.workdir")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cron-workdir"
                    value={form.workdir}
                    onChange={(e) => patch("workdir", e.target.value)}
                    placeholder={t("options.cron.form.workdir.placeholder")}
                    className="min-w-0 flex-1 font-mono text-xs"
                    disabled={busy}
                  />
                  {chooseDirectory && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full"
                      aria-label={t("options.cron.form.workdir.choose")}
                      disabled={busy}
                      onClick={() => {
                        void chooseDirectory(form.workdir || undefined).then(
                          (path) => path && patch("workdir", path),
                        );
                      }}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cron-deliver" className="text-xs">
                  {t("options.cron.form.delivery")}
                </Label>
                <Input
                  id="cron-deliver"
                  list="cron-delivery-targets"
                  value={form.deliver}
                  onChange={(event) => patch("deliver", event.target.value)}
                  placeholder="local / all / feishu:oc_xxx"
                  className="font-mono text-xs"
                  disabled={busy}
                />
                <datalist id="cron-delivery-targets">
                  <option value="local" />
                  <option value="origin" />
                  <option value="all" />
                </datalist>
                <p className="text-[10px] text-muted-foreground">
                  {t("options.cron.form.delivery.hint")}
                </p>
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                {advancedOpen
                  ? t("options.cron.form.advanced.hide")
                  : t("options.cron.form.advanced.show")}
              </button>
            </div>

            {advancedOpen && (
              <div className="space-y-3 rounded-xl border border-border/60 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">
                      {t("options.cron.form.directScript")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("options.cron.form.directScript.hint")}
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
                    {t("options.cron.form.script")}
                  </Label>
                  <Input
                    id="cron-script"
                    value={form.script}
                    onChange={(e) => patch("script", e.target.value)}
                    placeholder={t("options.cron.form.script.placeholder")}
                    className="font-mono text-xs"
                    disabled={busy}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cron-repeat" className="text-xs">
                    {t("options.cron.form.repeat")}
                  </Label>
                  <Input
                    id="cron-repeat"
                    type="number"
                    min={0}
                    value={form.repeat}
                    onChange={(e) => patch("repeat", e.target.value)}
                    placeholder={t("options.cron.form.repeat.placeholder")}
                    className="text-xs"
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void onSubmit(form)}>
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {mode === "create"
              ? t("options.cron.form.createAction")
              : t("common.save")}
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
  const scheduleLabel = humanizeSchedule(job.schedule_display, language);
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
  const showStateLabel =
    job.state !== "scheduled" &&
    job.state !== "paused" &&
    job.state !== "completed";
  const scheduleStateLabel = paused
    ? t("options.cron.state.paused")
    : completed
      ? t("options.cron.state.completed")
      : job.next_run_at
        ? t("options.cron.meta.nextRun", { time: nextRun })
        : t("options.cron.meta.noNextRun");

  return (
    <li className="group relative rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-muted/20 focus-within:bg-muted/20">
      <div className="flex min-w-0 items-start gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={!paused && !completed}
              aria-label={
                completed
                  ? t("options.cron.state.completed")
                  : paused
                    ? t("options.cron.action.resumeNamed", {
                        name: job.name || job.id,
                      })
                    : t("options.cron.action.pauseNamed", {
                        name: job.name || job.id,
                      })
              }
              disabled={busy || completed}
              onClick={() => (paused ? onResume(job) : onPause(job))}
              className="group/task-toggle mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:ring-offset-1 disabled:cursor-default disabled:opacity-35"
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current transition-colors duration-150",
                  paused
                    ? "text-muted-foreground/30 group-hover/task-toggle:text-muted-foreground/44"
                    : job.state === "error" || job.last_status === "error"
                      ? "text-destructive/30 group-hover/task-toggle:text-destructive/45"
                      : "text-foreground/20 group-hover/task-toggle:text-foreground/30",
                )}
              >
                {busy ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : paused ? (
                  <Play
                    className="ml-[0.5px] h-1.5 w-1.5 fill-current"
                    strokeWidth={1}
                  />
                ) : completed ? null : (
                  <span className="flex h-2 items-center gap-px opacity-0 transition-opacity duration-150 group-hover/task-toggle:opacity-100 group-focus-visible/task-toggle:opacity-100">
                    <span className="h-1.5 w-[1.5px] rounded-full bg-current" />
                    <span className="h-1.5 w-[1.5px] rounded-full bg-current" />
                  </span>
                )}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {completed
              ? t("options.cron.state.completed")
              : paused
                ? t("options.cron.action.resume")
                : t("options.cron.action.pause")}
          </TooltipContent>
        </Tooltip>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[13px] font-medium tracking-[-0.005em] text-foreground">
              {job.name || job.id}
            </h3>
            {showStateLabel && (
              <span
                className={cn(
                  "shrink-0 text-[10.5px]",
                  job.state === "error" || job.last_status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground/75",
                )}
              >
                {stateLabel}
              </span>
            )}
            {job.no_agent && (
              <span
                className="shrink-0 rounded bg-muted/65 px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground/80"
                title="no_agent"
              >
                {t("options.cron.mode.directScript")}
              </span>
            )}
          </div>

          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground/75">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default text-foreground/58">
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
            <span
              title={
                paused || completed
                  ? undefined
                  : formatAbsolute(job.next_run_at, language)
              }
            >
              {scheduleStateLabel}
            </span>
          </div>

          {issue && (
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-destructive">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{issue}</span>
            </div>
          )}
        </div>

        <div className="flex h-7 shrink-0 items-center">
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

  const openMenu = useCallback(() => {
    setOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  const runAndClose = (action: () => void) => {
    closeMenu();
    action();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          disabled={busy}
          aria-label={t("options.cron.action.moreNamed", {
            name: job.name || job.id,
          })}
          aria-haspopup="menu"
          aria-expanded={open}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        aria-label={t("options.cron.action.menu")}
        onKeyDown={onMenuKeyDown}
        ref={menuRef}
        role="menu"
        side="bottom"
        size="menu"
      >
        <TaskMenuItem
          icon={<CirclePlay />}
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
      </PopoverContent>
    </Popover>
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobFilter>("all");
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
  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return jobs.filter((job) => {
      const paused = job.state === "paused" || !job.enabled;
      const completed = job.state === "completed";
      if (filter === "enabled" && (paused || completed)) return false;
      if (filter === "paused" && !paused) return false;
      if (!normalizedQuery) return true;
      return [
        job.name,
        job.id,
        job.prompt,
        job.script,
        job.schedule_display,
      ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [filter, jobs, query]);
  const hasActiveSearch = query.trim().length > 0 || filter !== "all";
  const filters: { id: JobFilter; label: string }[] = [
    { id: "all", label: t("options.cron.filter.all") },
    { id: "enabled", label: t("options.cron.filter.enabled") },
    { id: "paused", label: t("options.cron.filter.paused") },
  ];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[808px] px-6 pb-14 pt-4">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t("options.cron.search")}
                  placeholder={t("options.cron.search")}
                  className="h-9 rounded-full border-border/65 bg-transparent pl-9 pr-4 text-xs shadow-none placeholder:text-muted-foreground/65 focus-visible:border-foreground/20 focus-visible:ring-1 focus-visible:ring-ring/30"
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground/80"
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
                className="h-8 gap-1.5 rounded-lg px-3 text-xs shadow-none"
                onClick={() => setCreating(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("options.cron.newJob")}
              </Button>
            </div>

            <div className="mt-4 flex min-h-8 items-center justify-between gap-3">
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label={t("options.cron.filter.label")}
              >
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                    className={cn(
                      "h-7 rounded-lg px-2.5 text-[11px] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      filter === item.id
                        ? "bg-muted/75 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/35 hover:text-foreground/80",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {notice && (
                <p
                  role="status"
                  aria-live="polite"
                  className="truncate text-[10.5px] text-muted-foreground/75"
                >
                  {notice}
                </p>
              )}
            </div>

            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            {actionError && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
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
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <span className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted/55 text-muted-foreground/70">
                  <CalendarClock className="h-3.5 w-3.5" />
                </span>
                <p className="text-[12px] font-medium text-foreground/85">
                  {t("options.cron.empty.title")}
                </p>
                <p className="mt-1 max-w-sm text-[11px] leading-5 text-muted-foreground/75">
                  {t("options.cron.empty.description")}
                </p>
              </div>
            ) : filteredJobs.length === 0 && hasActiveSearch ? (
              <div className="py-16 text-center">
                <p className="text-[12px] text-muted-foreground">
                  {t("options.cron.search.empty")}
                </p>
              </div>
            ) : (
              <ul className="mt-3 space-y-0.5">
                {filteredJobs.map((job) => (
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
