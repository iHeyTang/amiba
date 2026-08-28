import {
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  Newspaper,
  NotebookPen,
  Play,
  Plus,
  RefreshCw,
  Search,
  SquarePen,
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
  ChipSwitcher,
  PageContent,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
  startCreationChat(seedPrompt: string): Promise<{ sessionId: string }>;
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
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
          ? { kind: "daily", time: dailyTime, timeZone }
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

  const fieldLabel = "text-xs font-medium text-muted-foreground";
  const inlineInput =
    "h-8 w-auto bg-transparent shadow-none focus-visible:bg-transparent";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("cron.new.manual")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label className={fieldLabel}>{t("cron.form.name")}</Label>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("cron.form.namePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className={fieldLabel}>{t("cron.form.prompt")}</Label>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("cron.form.promptPlaceholder")}
              rows={4}
              className="resize-none"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className={fieldLabel}>{t("cron.form.rule")}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <ChipSwitcher
                options={["daily", "every", "at"] as const}
                value={mode}
                onChange={setMode}
                formatLabel={(value) => t(`cron.form.rule.${value}` as never)}
              />
              {/* The rule reads as one sentence; only its blank changes. */}
              {mode === "daily" && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {t("cron.form.dailyTime")}
                  <Input
                    type="time"
                    value={dailyTime}
                    onChange={(event) => setDailyTime(event.target.value)}
                    className={cn(inlineInput, "w-28")}
                  />
                </span>
              )}
              {mode === "every" && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {t("cron.form.everyPrefix")}
                  <Input
                    type="number"
                    min={5}
                    value={everyMinutes}
                    onChange={(event) => setEveryMinutes(event.target.value)}
                    className={cn(inlineInput, "w-20")}
                  />
                  {t("cron.form.everySuffix")}
                </span>
              )}
              {mode === "at" && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {t("cron.form.at")}
                  <Input
                    type="datetime-local"
                    value={at}
                    onChange={(event) => setAt(event.target.value)}
                    className={cn(inlineInput, "w-52")}
                  />
                </span>
              )}
            </div>
            {mode === "daily" && (
              <p className="text-[11px] text-muted-foreground/70">
                {t("cron.form.timeZoneNote", { zone: timeZone })}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm text-foreground">{t("cron.form.catchUp")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("cron.form.catchUpHint")}
              </p>
            </div>
            <Switch
              checked={catchUp}
              aria-label={t("cron.form.catchUp")}
              onCheckedChange={setCatchUp}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            {t("cron.form.footnote")}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("cron.form.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !name.trim() || !prompt.trim()}
          >
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatStarting, setChatStarting] = useState(false);
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

  const startChat = async () => {
    setChatStarting(true);
    setError(null);
    try {
      const { sessionId } = await adapter.startCreationChat(
        t("cron.creationSeed"),
      );
      onOpenSession(sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChatStarting(false);
    }
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
            {/* Split control, Codex-style: the button itself starts the
                conversational path (the agent has real cron_* tools); the
                chevron opens the two explicit choices. */}
            <div className="flex items-center">
              <Button
                type="button"
                size="sm"
                disabled={chatStarting}
                className="h-7 gap-1.5 rounded-l-lg rounded-r-none px-2.5 text-xs shadow-none [&_svg]:size-3.5"
                onClick={() => void startChat()}
              >
                {chatStarting ? <Loader2 className="animate-spin" /> : <Plus />}
                {t("cron.new")}
              </Button>
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    aria-label={t("cron.new")}
                    className="h-7 rounded-l-none rounded-r-lg border-l border-primary-foreground/20 px-1.5 shadow-none [&_svg]:size-3.5"
                  >
                    <ChevronDown />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-1.5">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
                    onClick={() => {
                      setMenuOpen(false);
                      void startChat();
                    }}
                  >
                    <MessageSquarePlus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">
                        {t("cron.new.chat")}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t("cron.new.chatHint")}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
                    onClick={() => {
                      setMenuOpen(false);
                      openCreate(null);
                    }}
                  >
                    <SquarePen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">
                        {t("cron.new.manual")}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t("cron.new.manualHint")}
                      </span>
                    </span>
                  </button>
                </PopoverContent>
              </Popover>
            </div>
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
                // A quiet field: border only — no fill, no shadow.
                className="h-10 bg-transparent pl-9 shadow-none hover:bg-transparent focus-visible:bg-transparent"
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
              // No hero block: one quiet line, and the suggestions below ARE
              // the empty state — same page shape whether full or empty.
              <p className="mt-6 text-sm text-muted-foreground">
                {tasks.length === 0
                  ? t("cron.empty.line")
                  : t("cron.empty.noMatch")}
              </p>
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
