import {
  CalendarClock,
  CircleAlert,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePluginT as useT } from "@amiba/i18n/plugin";
import {
  type AgentScheduleCreateInput,
  type AgentSchedulesAdapter,
  type AgentScheduleView,
  type AgentSessionsAdapter,
  type AgentSessionSummary,
} from "@amiba/app-runtime/platform";

import {
  Button,
  CollectionState,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageContent,
  ScrollArea,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "../primitives";
import { SidebarExpandControl } from "../navigation/SidebarExpandControl";

export interface DshScheduledTasksPageProps {
  adapter: AgentSchedulesAdapter;
  sessionsAdapter: Pick<AgentSessionsAdapter, "list">;
  activeSessionId?: string;
  topBarHeightPx?: number;
  topBarClassName?: string;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
  onExpandSidebar?: () => void;
}

type RuleMode = "after" | "at" | "every";
type JobFilter = "all" | "scheduled" | "overdue";
type ScheduleListItem = AgentScheduleView & { sessionTitle: string };

function formatTarget(iso: string, language: "en" | "zh-CN"): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleString(language === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso: string, language: "en" | "zh-CN"): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";
  const difference = timestamp - Date.now();
  const absolute = Math.abs(difference);
  const formatter = new Intl.RelativeTimeFormat(
    language === "zh-CN" ? "zh-CN" : "en-US",
    { numeric: "auto" },
  );
  if (absolute < 60_000)
    return formatter.format(Math.round(difference / 1_000), "second");
  if (absolute < 3_600_000)
    return formatter.format(Math.round(difference / 60_000), "minute");
  if (absolute < 86_400_000)
    return formatter.format(Math.round(difference / 3_600_000), "hour");
  return formatter.format(Math.round(difference / 86_400_000), "day");
}

function scheduleLabel(
  item: AgentScheduleView,
  language: "en" | "zh-CN",
): string {
  if (item.kind === "every") {
    const minutes = Math.round((item.everySeconds ?? 0) / 60);
    return language === "zh-CN"
      ? `每 ${minutes} 分钟`
      : `Every ${minutes} minutes`;
  }
  return formatTarget(item.scheduledAt, language);
}

function ReminderDialog({
  open,
  busy,
  sessions,
  sessionId,
  onOpenChange,
  onSessionChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  sessions: AgentSessionSummary[];
  sessionId: string;
  onOpenChange(open: boolean): void;
  onSessionChange(sessionId: string): void;
  onSubmit(sessionId: string, input: AgentScheduleCreateInput): Promise<void>;
}) {
  const { t } = useT();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<RuleMode>("after");
  const [amount, setAmount] = useState("30");
  const [at, setAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setMode("after");
    setAmount("30");
    setAt("");
    setError(null);
  }, [open]);

  const submit = async () => {
    const text = prompt.trim();
    if (!text) {
      setError(t("options.cron.dsh.error.prompt"));
      return;
    }
    let input: AgentScheduleCreateInput;
    if (mode === "at") {
      const instant = new Date(at);
      if (
        !at ||
        Number.isNaN(instant.getTime()) ||
        instant.getTime() <= Date.now()
      ) {
        setError(t("options.cron.dsh.error.future"));
        return;
      }
      input = { prompt: text, at: instant.toISOString() };
    } else {
      const minutes = Number(amount);
      const minimum = mode === "every" ? 5 : 1;
      if (!Number.isSafeInteger(minutes) || minutes < minimum) {
        setError(
          mode === "every"
            ? t("options.cron.dsh.error.interval")
            : t("options.cron.dsh.error.delay"),
        );
        return;
      }
      input = {
        prompt: text,
        ...(mode === "every"
          ? { everySeconds: minutes * 60 }
          : { afterSeconds: minutes * 60 }),
      };
    }
    setError(null);
    if (!sessionId) return;
    await onSubmit(sessionId, input);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("options.cron.dsh.new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="dsh-reminder-session" className="text-xs">
              {t("options.cron.dsh.session")}
            </Label>
            <select
              id="dsh-reminder-session"
              value={sessionId}
              onChange={(event) => onSessionChange(event.target.value)}
              disabled={busy}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              {sessions.map((session) => (
                <option key={session.sessionId} value={session.sessionId}>
                  {session.title || session.sessionId}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dsh-reminder-prompt" className="text-xs">
              {t("options.cron.dsh.prompt")}
            </Label>
            <Textarea
              id="dsh-reminder-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("options.cron.dsh.prompt.placeholder")}
              rows={4}
              disabled={busy}
            />
          </div>
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dsh-reminder-rule" className="text-xs">
                {t("options.cron.dsh.rule")}
              </Label>
              <select
                id="dsh-reminder-rule"
                value={mode}
                onChange={(event) => setMode(event.target.value as RuleMode)}
                disabled={busy}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="after">
                  {t("options.cron.dsh.rule.after")}
                </option>
                <option value="at">{t("options.cron.dsh.rule.at")}</option>
                <option value="every">
                  {t("options.cron.dsh.rule.every")}
                </option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsh-reminder-value" className="text-xs">
                {mode === "at"
                  ? t("options.cron.dsh.at")
                  : t("options.cron.dsh.minutes")}
              </Label>
              <Input
                id="dsh-reminder-value"
                type={mode === "at" ? "datetime-local" : "number"}
                min={mode === "every" ? 5 : 1}
                step={1}
                value={mode === "at" ? at : amount}
                onChange={(event) =>
                  mode === "at"
                    ? setAt(event.target.value)
                    : setAmount(event.target.value)
                }
                disabled={busy}
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("options.cron.dsh.sessionHint")}
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !sessionId}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("options.cron.form.createAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DshScheduledTasksPage({
  adapter,
  sessionsAdapter,
  activeSessionId,
  topBarHeightPx = 40,
  topBarClassName,
  topBarLeftInset = 0,
  sidebarCollapsed = false,
  showSidebarExpandControl = sidebarCollapsed,
  onExpandSidebar,
}: DshScheduledTasksPageProps) {
  const { t, language } = useT();
  const [selectable, setSelectable] = useState<AgentSessionSummary[]>([]);
  const [dialogSessionId, setDialogSessionId] = useState("");
  const [items, setItems] = useState<ScheduleListItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<JobFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshSessions = useCallback(async () => {
    const items = await sessionsAdapter.list();
    setSelectable(items.filter((session) => !session.origin));
  }, [sessionsAdapter]);

  useEffect(() => {
    void refreshSessions().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [activeSessionId, refreshSessions]);

  useEffect(() => {
    if (
      dialogSessionId &&
      selectable.some((session) => session.sessionId === dialogSessionId)
    )
      return;
    setDialogSessionId(
      selectable.some((session) => session.sessionId === activeSessionId)
        ? activeSessionId ?? ""
        : selectable[0]?.sessionId || "",
    );
  }, [activeSessionId, dialogSessionId, selectable]);

  const refresh = useCallback(async () => {
    if (selectable.length === 0) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const schedules = await Promise.all(
        selectable.map(async (session) => {
          const sessionItems = await adapter.list(session.sessionId);
          return sessionItems.map((item) => ({
            ...item,
            sessionTitle: session.title || session.sessionId,
          }));
        }),
      );
      setItems(schedules.flat());
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter, selectable]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.state !== filter) return false;
      return (
        !needle ||
        `${item.id} ${item.prompt} ${item.sessionTitle}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    });
  }, [filter, items, query]);

  const create = async (sessionId: string, input: AgentScheduleCreateInput) => {
    setBusy(true);
    try {
      const created = await adapter.create(sessionId, input);
      const owner = selectable.find(
        (session) => session.sessionId === sessionId,
      );
      setItems((current) => [
        ...current,
        {
          ...created,
          sessionTitle: owner?.title || owner?.sessionId || sessionId,
        },
      ]);
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: AgentScheduleView) => {
    if (!confirm(t("options.cron.dsh.deleteConfirm", { name: item.prompt })))
      return;
    setBusy(true);
    setError(null);
    try {
      await adapter.remove(item.sessionId, item.id);
      setItems((current) =>
        current.filter(
          (candidate) =>
            candidate.id !== item.id || candidate.sessionId !== item.sessionId,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <header
          className={cn(
            "flex shrink-0 items-center bg-background pr-2",
            topBarClassName,
          )}
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
          <div className="app-no-drag ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
                  disabled={loading}
                  aria-label={t("options.cron.refresh")}
                  onClick={() => void refresh()}
                >
                  <RefreshCw className={cn(loading && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("options.cron.refresh")}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-xs shadow-none [&_svg]:size-3.5"
              disabled={selectable.length === 0}
              onClick={() => setCreating(true)}
            >
              <Plus />
              {t("options.cron.dsh.new")}
            </Button>
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <PageContent title={t("options.cron.title")}>
            <div className="relative min-w-0">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t("options.cron.search")}
                placeholder={t("options.cron.search")}
                className="h-9 rounded-lg border-border/65 bg-transparent pl-9 pr-4 text-xs shadow-none placeholder:text-muted-foreground/65 focus-visible:border-foreground/20 focus-visible:ring-1 focus-visible:ring-ring/30"
              />
            </div>

            <div className="mt-4 flex min-h-8 items-center justify-between gap-3">
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label={t("options.cron.filter.label")}
              >
                {(
                  [
                    ["all", t("options.cron.filter.all")],
                    ["scheduled", t("options.cron.dsh.filter.scheduled")],
                    ["overdue", t("options.cron.dsh.filter.overdue")],
                  ] as Array<[JobFilter, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                    className={cn(
                      "h-7 rounded-lg px-2.5 text-[11px] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                      filter === id
                        ? "bg-muted/75 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/35 hover:text-foreground/80",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {error ? (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-destructive">
                <CircleAlert className="h-3.5 w-3.5" />
                <p>{error}</p>
              </div>
            ) : null}

            {loading && items.length === 0 ? (
              <CollectionState
                className="min-h-0 py-20"
                icon={<Loader2 className="animate-spin" />}
              >
                {t("options.cron.loading")}
              </CollectionState>
            ) : selectable.length === 0 ? (
              <CollectionState
                className="min-h-0 py-20"
                icon={<CalendarClock />}
              >
                {t("options.cron.dsh.noSession")}
              </CollectionState>
            ) : items.length === 0 ? (
              <CollectionState
                className="min-h-0 py-20"
                icon={<CalendarClock />}
              >
                {t("options.cron.empty.title")}
              </CollectionState>
            ) : filtered.length === 0 ? (
              <CollectionState className="min-h-0 py-20" icon={<Search />}>
                {t("options.cron.search.empty")}
              </CollectionState>
            ) : (
              <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-0.5 md:grid-cols-2">
                {filtered.map((item) => (
                  <li
                    key={`${item.sessionId}:${item.id}`}
                    className="group relative rounded-xl px-2.5 py-3 transition-colors duration-150 hover:bg-muted/30 focus-within:bg-muted/30"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-muted/55 text-muted-foreground/80">
                        <CalendarClock className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
                            {item.prompt}
                          </h3>
                          {item.state === "overdue" ? (
                            <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">
                              {t("options.cron.dsh.overdue")}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground/75">
                          <span className="cursor-default text-foreground/58">
                            {scheduleLabel(item, language)}
                          </span>
                          <span
                            title={formatTarget(item.scheduledAt, language)}
                          >
                            {formatRelative(item.scheduledAt, language)}
                          </span>
                          <span className="truncate">{item.sessionTitle}</span>
                        </div>
                      </div>
                      <div className="flex h-7 shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 [&_svg]:size-3.5"
                          aria-label={t("options.cron.action.copyId")}
                          onClick={() =>
                            void navigator.clipboard.writeText(item.id)
                          }
                        >
                          <Copy />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive [&_svg]:size-3.5"
                          disabled={busy}
                          aria-label={t("options.cron.action.delete")}
                          onClick={() => void remove(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PageContent>
        </ScrollArea>
        <ReminderDialog
          open={creating}
          busy={busy}
          sessions={selectable}
          sessionId={dialogSessionId}
          onOpenChange={setCreating}
          onSessionChange={setDialogSessionId}
          onSubmit={create}
        />
      </div>
    </TooltipProvider>
  );
}
