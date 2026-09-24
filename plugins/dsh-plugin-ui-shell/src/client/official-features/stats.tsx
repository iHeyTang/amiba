import type {} from "@deepseek-ai/dsh-token-meter/client";
import type {} from "@deepseek-ai/dsh-session-stats/client";
import { useState, type ReactNode } from "react";
import { Database, Gauge } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@amiba/ui/primitives";
import type { UseProjection } from "@deepseek-ai/dsh-api-session-controller/client";
import type { ChatViewSlotProps } from "@deepseek-ai/dsh-client-ui-chat/client";

type Props = { useProjection: UseProjection; t: ChatViewSlotProps["t"] };

/** The official durable projections own accounting; never sum the paged transcript. */
export function SessionStats({ useProjection, t }: Props) {
  const usage = useProjection("tokenUsage");
  const stats = useProjection("sessionStats");
  const [open, setOpen] = useState<"usage" | "time" | null>(null);
  const input = usage
    ? usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    : 0;
  const total = input + (usage?.outputTokens ?? 0);
  const hit =
    input > 0 && usage
      ? usage.cacheReadTokens === input
        ? "100"
        : Math.min(99.99, (usage.cacheReadTokens / input) * 100)
            .toFixed(2)
            .replace(/\.?0+$/, "")
      : null;
  const count = (value: number) =>
    t("message.turnUsage.count", { count: value.toLocaleString() });
  const duration = (ms: number) =>
    ms < 60_000
      ? t("duration.compactSeconds", { seconds: Math.round(ms / 100) / 10 })
      : t("duration.compactMinutes", {
          minutes: Math.floor(Math.round(ms / 1000) / 60),
          seconds: Math.round(ms / 1000) % 60,
        });
  if (total <= 0 && !stats?.steps) return null;
  const pill = (
    id: "usage" | "time",
    icon: ReactNode,
    label: ReactNode,
    title: string,
    details: ReactNode,
  ) => (
    <Popover
      open={open === id}
      onOpenChange={(value) => setOpen(value ? id : null)}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={title}
        >
          {icon}
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 text-xs"
        aria-label={title}
      >
        <div className="mb-3 font-medium text-foreground">{title}</div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-muted-foreground [&_dd]:text-right [&_dd]:tabular-nums [&_dd]:text-foreground">
          {details}
        </dl>
      </PopoverContent>
    </Popover>
  );
  return (
    <div
      data-composer-stats
      className="flex flex-wrap items-center gap-x-1 px-1 pt-1 tabular-nums"
    >
      {usage &&
        total > 0 &&
        pill(
          "usage",
          <Database size={12} />,
          <>
            {count(total)}
            {hit !== null && <> · {t("stats.cacheHit", { percent: hit })}</>}
          </>,
          t("stats.dialog.usageTitle"),
          <>
            <dt>{t("stats.dialog.usageTitle")}</dt>
            <dd>{count(total)}</dd>
            <dt>{t("message.turnUsage.input")}</dt>
            <dd>{count(usage.uncachedInputTokens)}</dd>
            <dt>{t("message.turnUsage.cacheRead")}</dt>
            <dd>{count(usage.cacheReadTokens)}</dd>
            {usage.cacheWriteTokens > 0 && (
              <>
                <dt>{t("message.turnUsage.cacheWrite")}</dt>
                <dd>{count(usage.cacheWriteTokens)}</dd>
              </>
            )}
            <dt>{t("message.turnUsage.output")}</dt>
            <dd>{count(usage.outputTokens)}</dd>
            {hit !== null && (
              <>
                <dt>{t("message.turnUsage.cacheHit")}</dt>
                <dd>{hit}%</dd>
              </>
            )}
          </>,
        )}
      {stats &&
        stats.steps > 0 &&
        pill(
          "time",
          <Gauge size={12} />,
          t("stats.counts", { turns: stats.turns, steps: stats.steps }),
          t("stats.dialog.title"),
          <>
            <dt>
              {t("stats.counts", { turns: stats.turns, steps: stats.steps })}
            </dt>
            <dd />
            {stats.llmMs > 0 && (
              <>
                <dt>{t("stats.dialog.llmTime")}</dt>
                <dd>{duration(stats.llmMs)}</dd>
              </>
            )}
            {stats.toolMs > 0 && (
              <>
                <dt>{t("stats.dialog.toolTime")}</dt>
                <dd>{duration(stats.toolMs)}</dd>
              </>
            )}
            {stats.ttftSteps > 0 && (
              <>
                <dt>{t("stats.dialog.ttft")}</dt>
                <dd>{duration(stats.ttftMs / stats.ttftSteps)}</dd>
              </>
            )}
            {stats.decodeMs > 0 && (
              <>
                <dt>{t("stats.dialog.speed")}</dt>
                <dd>
                  {t("message.tokensPerSecond", {
                    tps: (stats.decodeTokens / (stats.decodeMs / 1000)).toFixed(
                      1,
                    ),
                  })}
                </dd>
              </>
            )}
          </>,
        )}
    </div>
  );
}
