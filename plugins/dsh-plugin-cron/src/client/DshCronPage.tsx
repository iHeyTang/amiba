import {
  CalendarClock,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  Switch,
  Textarea,
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
  update(
    id: string,
    patch: { enabled?: boolean },
  ): Promise<CronTaskView>;
  removeTask(id: string): Promise<void>;
  runNow(id: string): Promise<CronTaskView>;
}

type RuleMode = CronRule["kind"];

function formatInstant(instant: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function ruleLabel(
  rule: CronRule,
  t: ReturnType<typeof useT>["t"],
  language: string,
): string {
  if (rule.kind === "at") {
    return t("cron.rule.at", { time: formatInstant(Date.parse(rule.at), language) });
  }
  if (rule.kind === "daily") return t("cron.rule.daily", { time: rule.time });
  return t("cron.rule.every", {
    minutes: Math.round(rule.everySeconds / 60),
  });
}

function CreateDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
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
  onToggle,
  onRunNow,
  onRemove,
  onOpenSession,
}: {
  task: CronTaskView;
  onToggle(enabled: boolean): void;
  onRunNow(): void;
  onRemove(): void;
  onOpenSession(sessionId: string): void;
}) {
  const { t, language } = useT();
  const timing = !task.enabled
    ? t("cron.row.disabled")
    : task.nextRunAt === null
      ? t("cron.row.exhausted")
      : `${t("cron.row.nextRun")} ${formatInstant(task.nextRunAt, language)}`;
  return (
    <div
      data-cron-task={task.id}
      className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{task.name}</span>
          <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {ruleLabel(task.rule, t, language)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {timing}
          {" · "}
          {task.lastRunAt
            ? `${t("cron.row.lastRun")} ${formatInstant(task.lastRunAt, language)}`
            : t("cron.row.never")}
        </div>
      </div>
      {task.lastSessionId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenSession(task.lastSessionId!)}
        >
          {t("cron.row.openLastRun")}
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        title={t("cron.row.runNow")}
        aria-label={t("cron.row.runNow")}
        onClick={onRunNow}
      >
        <Play className="h-3.5 w-3.5" />
      </Button>
      <Switch
        checked={task.enabled}
        aria-label={t("cron.row.enable")}
        onCheckedChange={onToggle}
      />
      <Button
        variant="ghost"
        size="sm"
        title={t("cron.row.delete")}
        aria-label={t("cron.row.delete")}
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function DshCronPage({
  adapter,
  onOpenSession,
}: {
  adapter: CronAdapter;
  onOpenSession(sessionId: string): void;
}) {
  const { t } = useT();
  const [tasks, setTasks] = useState<CronTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent title={t("cron.title")}>
          <div className="mb-3 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("cron.refresh")}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("cron.new")}
            </Button>
          </div>
          {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">{t("cron.loading")}</p>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <CalendarClock className="h-8 w-8 stroke-[1.5] text-muted-foreground/50" />
              <p className="text-sm font-medium">{t("cron.empty.title")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t("cron.empty.description")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={(enabled) =>
                    void adapter
                      .update(task.id, { enabled })
                      .then(refresh)
                      .catch((cause) => setError(String(cause)))
                  }
                  onRunNow={() =>
                    void adapter
                      .runNow(task.id)
                      .then(refresh)
                      .catch((cause) => setError(String(cause)))
                  }
                  onRemove={() =>
                    void adapter
                      .removeTask(task.id)
                      .then(refresh)
                      .catch((cause) => setError(String(cause)))
                  }
                  onOpenSession={onOpenSession}
                />
              ))}
            </div>
          )}
        </PageContent>
      </ScrollArea>
      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (input) => {
          await adapter.create(input);
          await refresh();
        }}
      />
    </div>
  );
}
