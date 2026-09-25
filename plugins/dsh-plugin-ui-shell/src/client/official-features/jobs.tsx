import { useEffect, useState } from "react";
import { ListTodo } from "lucide-react";
import type {
  PropsRuntime,
  PropsLocale,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@amiba/ui/primitives";
import type {} from "@deepseek-ai/dsh-client-ui-jobs/client";

type Props = PropsRuntime<"conversation.session.header.actions"> &
  PropsLocale<"job">;
export function JobsAction(props: Props) {
  // Changing the addressed session resets disclosure and its timer together.
  return <SessionJobs key={props.sessionId} {...props} />;
}
function SessionJobs({ sessionId, useSessions, t }: Props) {
  const jobs = useSessions((state) => state.jobsBySession[sessionId]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const live = (job: { status: string }) =>
    job.status === "running" || job.status === "stopping";
  const count = jobs?.filter(live).length ?? 0;
  useEffect(() => {
    if (!open || !count) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, count]);
  useEffect(() => {
    if (!jobs?.length) setOpen(false);
  }, [jobs?.length]);
  if (!jobs?.length) return null;
  const rows = [...jobs].sort(
    (a, b) =>
      Number(live(b)) - Number(live(a)) ||
      (live(a)
        ? a.startedAt - b.startedAt
        : (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt) ||
          a.startedAt - b.startedAt),
  );
  const label = t(
    count
      ? count === 1
        ? "count.live.one"
        : "count.live.other"
      : jobs.length === 1
        ? "count.idle.one"
        : "count.idle.other",
    { count: count || jobs.length },
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={label}
        >
          <ListTodo className="h-3.5 w-3.5" />
          <span>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" size="md">
        <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          {t("list.aria")}
        </p>
        <ul
          aria-label={t("list.aria")}
          className="max-h-80 space-y-1 overflow-y-auto"
        >
          {rows.map((job) => {
            const seconds = Math.floor(
              Math.max(
                0,
                (live(job) ? now : (job.finishedAt ?? job.startedAt)) -
                  job.startedAt,
              ) / 1000,
            );
            const duration =
              seconds >= 3600
                ? t("duration.hours", {
                    hours: Math.floor(seconds / 3600),
                    minutes: Math.floor(seconds / 60) % 60,
                  })
                : seconds >= 60
                  ? t("duration.minutes", {
                      minutes: Math.floor(seconds / 60),
                      seconds: seconds % 60,
                    })
                  : t("duration.seconds", { seconds });
            return (
              <li
                key={job.id}
                className="rounded-lg px-2 py-2 hover:bg-accent/50"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${job.status === "failed" ? "bg-destructive" : live(job) ? "bg-primary" : "bg-muted-foreground/40"}`}
                  />
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {job.label}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {duration}
                  </span>
                </div>
                <p className="ml-3.5 mt-1 text-xs text-muted-foreground">
                  {job.kind} · {t(`status.${job.status}`)}
                </p>
                {job.detail && (
                  <p className="ml-3.5 mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {job.detail}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
