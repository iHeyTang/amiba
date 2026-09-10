import {
  CodeEvidence,
  EvidenceShell,
  ToolRowFrame,
  oneline,
  recordOf,
  stringValue,
  toolCallArgs,
  toolCallDurationMs,
  toolCallFailed,
  toolCallResultText,
  toolCallSettled,
  usePluginT,
} from "@amiba/ui/plugin";
import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";

import type { CronRule } from "../types.js";
import { cronI18n } from "./i18n.js";

/**
 * The cron plugin's own `tool.call.toolview` occupants — the plugin that
 * registers `cron_create`/`cron_list`/`cron_delete` also owns how their
 * calls read in the timeline: task views render as structured rows (name,
 * human rule, prompt), never as the raw wire JSON.
 */

type CronBlock = Parameters<typeof toolCallArgs>[0];
type CronT = ReturnType<typeof usePluginT>["t"];

interface TaskViewLike {
  name: string;
  prompt: string;
  rule: CronRule | null;
  enabled: boolean;
}

function taskViewOf(value: unknown): TaskViewLike | null {
  const record = recordOf(value);
  if (!record || typeof record.name !== "string") return null;
  const rule = recordOf(record.rule);
  return {
    name: record.name,
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    rule:
      rule &&
      (rule.kind === "at" || rule.kind === "daily" || rule.kind === "every")
        ? (rule as unknown as CronRule)
        : null,
    enabled: record.enabled !== false,
  };
}

/** Task views from a tool result: one (create/runNow), many (list), none. */
function taskViewsOf(text: string): TaskViewLike[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) {
    const views = parsed.map(taskViewOf);
    return views.every((view) => view !== null)
      ? (views as TaskViewLike[])
      : null;
  }
  const single = taskViewOf(parsed);
  return single ? [single] : null;
}

function ruleText(t: CronT, rule: CronRule | null): string {
  if (!rule) return "";
  switch (rule.kind) {
    case "daily":
      return `${t("cron.rule.daily", { time: rule.time })} · ${rule.timeZone}`;
    case "every":
      return t("cron.rule.every", {
        minutes: Math.round(rule.everySeconds / 60),
      });
    case "at": {
      let time = rule.at;
      try {
        time = new Date(rule.at).toLocaleString();
      } catch {
        // Keep the raw instant.
      }
      return t("cron.rule.at", { time });
    }
  }
}

function TaskViewsEvidence({
  views,
  t,
}: {
  views: TaskViewLike[];
  t: CronT;
}): ReactNode {
  if (views.length === 0) {
    return (
      <p className="px-3 py-2 text-[11px] text-muted-foreground/70">
        {t("cron.empty.noMatch")}
      </p>
    );
  }
  return (
    <div className="space-y-2 px-3 py-2">
      {views.map((view, index) => (
        <div key={`${view.name}-${index}`} className="min-w-0">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] leading-relaxed">
            <span className="font-medium text-foreground/85">{view.name}</span>
            <span className="text-muted-foreground">
              {ruleText(t, view.rule)}
            </span>
            {!view.enabled && (
              <span className="text-muted-foreground/60">
                {t("cron.row.disabled")}
              </span>
            )}
          </p>
          {view.prompt && (
            <p className="mt-0.5 break-words text-[10.5px] leading-relaxed text-muted-foreground/75">
              {oneline(view.prompt, 200)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CronToolRow({ block, presentation }: { block: CronBlock; presentation?: "row" | "summary" }): ReactNode {
  const { t } = usePluginT(cronI18n);
  const args = toolCallArgs(block);
  const failed = toolCallFailed(block);
  const running = toolCallSettled(block) === null;
  const text = toolCallResultText(block);
  const durationMs = toolCallDurationMs(block);
  const target = oneline(stringValue(args, "name", "id"), 60);
  const views = !running && !failed ? taskViewsOf(text) : null;

  const body = failed ? (
    <CodeEvidence text={text} tone="error" />
  ) : views ? (
    <section className="overflow-hidden rounded-lg border border-border/40 bg-muted/[0.06]">
      <TaskViewsEvidence views={views} t={t} />
    </section>
  ) : !running && text ? (
    <CodeEvidence text={text} />
  ) : null;

  return (
    <ToolRowFrame
      presentation={presentation}
      icon={CalendarClock}
      action={t("cron.tool.action")}
      target={target || undefined}
      {...(durationMs === undefined ? {} : { durationMs })}
      running={running}
      failed={failed}
      detail={
        body ? <EvidenceShell tag="cron">{body}</EvidenceShell> : undefined
      }
    />
  );
}

export const CRON_TOOLVIEW_KEYS = [
  "cron_create",
  "cron_list",
  "cron_delete",
] as const;

export function CronToolview(props: { block: CronBlock; presentation?: "row" | "summary" }): ReactNode {
  return <CronToolRow {...props} />;
}
