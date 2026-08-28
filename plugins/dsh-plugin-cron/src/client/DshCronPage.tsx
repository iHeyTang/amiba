import {
  CalendarClock,
  Loader2,
  Newspaper,
  NotebookPen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageContent,
  ScrollArea,
  SidebarExpandControl,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  usePluginT,
} from "@amiba/ui/plugin";

import type {
  CronRule,
  CronTaskCreateInput,
  CronTaskView,
} from "../types.js";
import { cronI18n } from "./i18n.js";

function useT() {
  return usePluginT(cronI18n);
}

/** Management adapter the client wiring builds over the `amibaCron` remote. */
export interface CronAdapter {
  list(): Promise<CronTaskView[]>;
  create(input: CronTaskCreateInput): Promise<CronTaskView>;
  update(id: string, patch: { enabled?: boolean }): Promise<CronTaskView>;
  removeTask(id: string): Promise<void>;
  runNow(id: string): Promise<CronTaskView>;
}

type RuleMode = CronRule["kind"];
type TaskFilter = "all" | "enabled" | "disabled";

/** Prefill handed from a suggestion card into the create dialog. */
interface CreatePrefill {
  name: string;
  prompt: string;
  mode: RuleMode;
  dailyTime?: string;
  everyMinutes?: string;
}

function formatInstant(instant: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

/** "19小时后" / "3分钟前" — the Codex-style row subtitle vocabulary. */
function relativeTime(
  instant: number,
  now: number,
  t: ReturnType<typeof useT>["t"],
): string {
  const delta = instant - now;
  const magnitude = Math.abs(delta);
  const unit =
    magnitude < 3_600_000
      ? ([Math.max(1, Math.round(magnitude / 60_000)), "Minutes"] as const)
      : magnitude < 86_400_000
        ? ([Math.round(magnitude / 3_600_000), "Hours"] as const)
        : ([Math.round(magnitude / 86_400_000), "Days"] as const);
  const key = `cron.time.in${unit[1]}${delta < 0 ? "Ago" : ""}` as never;
  return t(key, { count: unit[0] });
}

function ruleLabel(
  rule: CronRule,
  t: ReturnType<typeof useT>["t"],
  language: string,
): string {
  if (rule.kind === "at") {
    return t("cron.rule.at", {
      time: formatInstant(Date.parse(rule.at), language),
    });
  }
  if (rule.kind === "daily") return t("cron.rule.daily", { time: rule.time });
  return t("cron.rule.every", { minutes: Math.round(rule.everySeconds / 60) });
}

function CreateDialog({
  open,
  prefill,
  onClose,
  onCreate,
}: {
  open: boolean;
  prefill: CreatePrefill | null;
  onClose(): void;
  onCreate(input: CronTaskCreateInput): Promise<void>;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<RuleMode>("daily");
  const [at, setAt] = useState("");
  const [dailyTime, setDailyTime] = useState("09:00");
  const [everyMinutes, setEveryMinutes] = useState("60");
  const [catchUp, setCatchUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A suggestion card seeds the form; the user still reviews and confirms.
  useEffect(() => {
    if (!open || !prefill) return;
    setName(prefill.name);
    setPrompt(prefill.prompt);
    setMode(prefill.mode);
    if (prefill.dailyTime) setDailyTime(prefill.dailyTime);
    if (prefill.everyMinutes) setEveryMinutes(prefill.everyMinutes);
  }, [open, prefill]);

  const submit = async () => {
    const rule: CronRule =
      mode === "at"
        ? { kind: "at", at: new Date(at).toISOString() }
        : mode === "daily"
          ? {
              kind: "daily",
              time: dailyTime,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }
          : { kind: "every", everySeconds: Number(everyMinutes) * 60 };
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name, prompt, rule, catchUp });
      setName("");
      setPrompt("");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cron.new")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("cron.form.name")}</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("cron.form.namePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("cron.form.prompt")}</Label>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("cron.form.promptPlaceholder")}
              rows={4}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("cron.form.rule")}</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={mode}
                onChange={(event) => setMode(event.target.value as RuleMode)}
              >
                <option value="daily">{t("cron.form.rule.daily")}</option>
                <option value="every">{t("cron.form.rule.every")}</option>
                <option value="at">{t("cron.form.rule.at")}</option>
              </select>
            </div>
            {mode === "at" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("cron.form.at")}</Label>
                <Input
                  type="datetime-local"
                  value={at}
                  onChange={(event) => setAt(event.target.value)}
                />
              </div>
            )}
            {mode === "daily" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("cron.form.dailyTime")}</Label>
                <Input
                  type="time"
                  value={dailyTime}
                  onChange={(event) => setDailyTime(event.target.value)}
                />
              </div>
            )}
            {mode === "every" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("cron.form.everyMinutes")}</Label>
                <Input
                  type="number"
                  min={5}
                  value={everyMinutes}
                  onChange={(event) => setEveryMinutes(event.target.value)}
                />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={catchUp}
              onChange={(event) => setCatchUp(event.target.checked)}
            />
            {t("cron.form.catchUp")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("cron.form.footnote")}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cron.form.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t("cron.form.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({
  task,
  now,
  onToggle,
  onRunNow,
  onRemove,
  onOpenSession,
}: {
  task: CronTaskView;
  now: number;
  onToggle(enabled: boolean): void;
  onRunNow(): void;
  onRemove(): void;
  onOpenSession(sessionId: string): void;
}) {
  const { t, language } = useT();
  const subtitle = [
    ruleLabel(task.rule, t, language),
    !task.enabled
      ? t("cron.row.disabled")
      : task.nextRunAt === null
        ? t("cron.row.exhausted")
        : t("cron.row.nextRunIn", {
            when: relativeTime(task.nextRunAt, now, t),
          }),
    ...(task.lastRunAt
      ? [t("cron.row.lastRunAt", { when: relativeTime(task.lastRunAt, now, t) })]
      : []),
  ].join(" · ");
  return (
    <li
      data-cron-task={task.id}
      className="group/task flex items-center gap-3 border-b border-border/40 py-3 last:border-b-0"
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          !task.enabled
            ? "bg-muted-foreground/30"
            : task.nextRunAt === null
              ? "bg-muted-foreground/50"
              : "bg-emerald-500/80",
        )}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        disabled={!task.lastSessionId}
        title={task.lastSessionId ? t("cron.row.openLastRun") : undefined}
        onClick={() => task.lastSessionId && onOpenSession(task.lastSessionId)}
      >
        <div className="truncate text-sm font-medium text-foreground">
          {task.name}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {subtitle}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/task:opacity-100 group-focus-within/task:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
              aria-label={t("cron.row.runNow")}
              onClick={onRunNow}
            >
              <Play />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("cron.row.runNow")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
              aria-label={t("cron.row.delete")}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("cron.row.delete")}</TooltipContent>
        </Tooltip>
      </div>
      <Switch
        checked={task.enabled}
        aria-label={t("cron.row.enable")}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
    </li>
  );
}

/** Honest templates: only shapes the rule set actually supports. */
function suggestions(t: ReturnType<typeof useT>["t"]): Array<
  CreatePrefill & { icon: typeof Newspaper; schedule: string; description: string }
> {
  return [
    {
      icon: Newspaper,
      name: t("cron.suggest.news.name"),
      schedule: t("cron.suggest.news.schedule"),
      description: t("cron.suggest.news.description"),
      prompt: t("cron.suggest.news.prompt"),
      mode: "daily",
      dailyTime: "09:00",
    },
    {
      icon: NotebookPen,
      name: t("cron.suggest.digest.name"),
      schedule: t("cron.suggest.digest.schedule"),
      description: t("cron.suggest.digest.description"),
      prompt: t("cron.suggest.digest.prompt"),
      mode: "daily",
      dailyTime: "18:00",
    },
  ];
}

export interface DshCronPageProps {
  adapter: CronAdapter;
  onOpenSession(sessionId: string): void;
  topBarHeightPx?: number;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
  onExpandSidebar?(): void;
}

export function DshCronPage({
  adapter,
  onOpenSession,
  topBarHeightPx = 40,
  topBarLeftInset = 0,
  sidebarCollapsed = false,
  showSidebarExpandControl = sidebarCollapsed,
  onExpandSidebar,
}: DshCronPageProps) {
  const { t } = useT();
  const [tasks, setTasks] = useState<CronTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [prefill, setPrefill] = useState<CreatePrefill | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await adapter.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (filter === "enabled" && !task.enabled) return false;
      if (filter === "disabled" && task.enabled) return false;
      if (!needle) return true;
      return `${task.name}\n${task.prompt}`.toLowerCase().includes(needle);
    });
  }, [tasks, query, filter]);

  const act = (work: Promise<unknown>) =>
    void work.then(refresh).catch((cause) => setError(String(cause)));

  const openCreate = (seed: CreatePrefill | null) => {
    setPrefill(seed);
    setCreating(true);
  };

  const filters: Array<{ id: TaskFilter; label: string }> = [
    { id: "all", label: t("cron.filter.all") },
    { id: "enabled", label: t("cron.filter.enabled") },
    { id: "disabled", label: t("cron.filter.disabled") },
  ];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {/* Same head geometry as the chat surface: drag strip, OS-chrome
            inset, expand control on the left, actions on the right. */}
        <header
          className="app-drag flex shrink-0 items-center bg-background pr-2"
          style={{
            height: topBarHeightPx,
            paddingLeft: sidebarCollapsed ? Math.max(topBarLeftInset, 12) : 10,
          }}
        >
          {onExpandSidebar ? (
            <SidebarExpandControl
              collapsed={sidebarCollapsed}
              onExpand={onExpandSidebar}
              visible={showSidebarExpandControl}
            />
          ) : null}
          <div className="app-no-drag ml-auto flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
                  disabled={loading}
                  aria-label={t("cron.refresh")}
                  onClick={() => void refresh()}
                >
                  <RefreshCw className={cn(loading && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("cron.refresh")}</TooltipContent>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-xs shadow-none [&_svg]:size-3.5"
              onClick={() => openCreate(null)}
            >
              <Plus />
              {t("cron.new")}
            </Button>
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <PageContent title={t("cron.title")}>
            <p className="-mt-2 mb-5 text-sm text-muted-foreground">
              {t("cron.subtitle")}
            </p>
            <div className="relative min-w-0">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("cron.searchPlaceholder")}
                className="h-10 pl-9"
              />
            </div>
            <div className="mt-3 flex items-center gap-1">
              {filters.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs transition-colors",
                    filter === id
                      ? "bg-secondary font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {error && (
              <p className="mt-3 text-xs text-destructive">{error}</p>
            )}
            {loading ? (
              <p className="mt-6 text-sm text-muted-foreground">
                {t("cron.loading")}
              </p>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-center">
                <CalendarClock className="h-8 w-8 stroke-[1.5] text-muted-foreground/50" />
                <p className="text-sm font-medium">{t("cron.empty.title")}</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {t("cron.empty.description")}
                </p>
              </div>
            ) : (
              <ul className="mt-2">
                {visible.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    now={now}
                    onToggle={(enabled) =>
                      act(adapter.update(task.id, { enabled }))
                    }
                    onRunNow={() => act(adapter.runNow(task.id))}
                    onRemove={() => act(adapter.removeTask(task.id))}
                    onOpenSession={onOpenSession}
                  />
                ))}
              </ul>
            )}
            <h2 className="mb-2 mt-10 text-sm font-semibold text-foreground">
              {t("cron.suggest.title")}
            </h2>
            <ul>
              {suggestions(t).map((suggestion) => (
                <li key={suggestion.name}>
                  <button
                    type="button"
                    onClick={() => openCreate(suggestion)}
                    className="group/suggest flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/40"
                  >
                    <suggestion.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {suggestion.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {suggestion.schedule}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {suggestion.description}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </PageContent>
        </ScrollArea>
        <CreateDialog
          open={creating}
          prefill={prefill}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            await adapter.create(input);
            await refresh();
          }}
        />
      </div>
    </TooltipProvider>
  );
}
