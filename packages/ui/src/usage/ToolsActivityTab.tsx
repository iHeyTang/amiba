/**
 * Tools activity tab — same layout vocabulary as the Tokens tab.
 *   • Hero trio    — Today: calls / distinct tools / unfinished
 *   • Activity     — heatmap of daily call density
 *   • Trend        — last N days of call volume + sparkline
 *   • By tool      — bar chart of share by tool, N-day window
 *   • Recent calls — newest-first list with duration / status
 *
 * Ported from the tool-meter extension's Activity panel; data now
 * flows through a host-injected ToolActivitySource instead of the
 * extension IPC bridge (see ./tool-usage.ts). Freshness is push-driven:
 * load on mount, refetch on window focus, and refetch on every ledger
 * write via `source.onChanged` — no polling.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import type { ToolActivityDayBucket, ToolActivitySource, ToolInvocation } from "@amiba/app-runtime/core"
import { useT, type TranslateFn } from "@amiba/i18n"

import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus"
import { cn, PageContent, ScrollArea } from "../primitives"
import { ChipSwitcher, Heatmap } from "../viz"
import { readUsagePref, writeUsagePref } from "./prefs"
import {
  fetchToolHeatmap,
  fetchToolRecent,
  fetchToolSummary,
  type MeterSummary,
  type ToolHeatmapCell,
} from "./tool-usage"

const RECENT_LIMIT = 30
const HEATMAP_WEEKS = 52
const DAY_RANGES = [1, 3, 7] as const
type DayRange = (typeof DAY_RANGES)[number]
const TREND_RANGE_SETTING_KEY = "usage.tools.ui.trend.days"
const BYTOOL_RANGE_SETTING_KEY = "usage.tools.ui.bytool.days"

const MONTH_NAMES_ZH = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
]

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

function formatDuration(ms: number | undefined, t: TranslateFn): string {
  if (ms === undefined) return t("usage.tools.label.running")
  return t("usage.tools.label.completed", { ms: String(Math.round(ms)) })
}

function formatShortSession(id: string | undefined): string {
  if (!id) return "—"
  return id.length > 8 ? id.slice(0, 8) + "…" : id
}

function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function formatMonthDay(day: string): string {
  return day.slice(5)
}

function dayRangeLabel(n: DayRange, t: TranslateFn): string {
  return n === 1 ? t("usage.range.today") : t("usage.range.lastN", { n: String(n) })
}

// ---------------------------------------------------------------------------
// ToolsActivityTab — the analytics panel, behavior unchanged from the ext
// ---------------------------------------------------------------------------

export function ToolsActivityTab({ source }: { source?: ToolActivitySource }) {
  const reader = source?.read
  const { t, language } = useT()

  const [summary, setSummary] = useState<MeterSummary | null>(null)
  const [recent, setRecent] = useState<ToolInvocation[]>([])
  const [heatmap, setHeatmap] = useState<ToolHeatmapCell[]>([])
  const [trendDays, setTrendDays] = useState<DayRange>(7)
  const [byToolDays, setByToolDays] = useState<DayRange>(7)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void readUsagePref<DayRange>(TREND_RANGE_SETTING_KEY, 7)
      .then((stored) => {
        if (DAY_RANGES.includes(stored)) setTrendDays(stored)
      })
    void readUsagePref<DayRange>(BYTOOL_RANGE_SETTING_KEY, 7)
      .then((stored) => {
        if (DAY_RANGES.includes(stored)) setByToolDays(stored)
      })
  }, [])

  const refresh = useCallback(async () => {
    if (!reader) return
    setError(null)
    try {
      const [s, r, h] = await Promise.all([
        fetchToolSummary(reader),
        fetchToolRecent(reader, RECENT_LIMIT),
        fetchToolHeatmap(reader, HEATMAP_WEEKS),
      ])
      setSummary(s)
      setRecent(r)
      setHeatmap(h)
    } catch (e) {
      setError((e as Error).message ?? String(e))
    }
  }, [reader])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Push: main broadcasts (debounced) on every ledger write.
  useEffect(() => {
    if (!source?.onChanged) return
    return source.onChanged(() => void refresh())
  }, [source, refresh])

  useRefetchOnFocus(() => void refresh())

  const changeTrendRange = useCallback(
    (days: DayRange) => {
      if (days === trendDays) return
      setTrendDays(days)
      writeUsagePref(TREND_RANGE_SETTING_KEY, days)
    },
    [trendDays],
  )

  const changeByToolRange = useCallback(
    (days: DayRange) => {
      if (days === byToolDays) return
      setByToolDays(days)
      writeUsagePref(BYTOOL_RANGE_SETTING_KEY, days)
    },
    [byToolDays],
  )

  const trendBuckets = useMemo<ToolActivityDayBucket[]>(() => {
    if (!summary) return []
    return summary.last7Days.slice(0, trendDays)
  }, [summary, trendDays])

  const byToolView = useMemo(() => {
    if (!summary) return [] as Array<{ tool: string; calls: number }>
    const rows = summary.byToolLast7.map((m) => {
      const slice = m.perDay.slice(0, byToolDays)
      const calls = slice.reduce((s, d) => s + d.calls, 0)
      return { tool: m.tool, calls }
    })
    return rows.filter((r) => r.calls > 0).sort((a, b) => b.calls - a.calls)
  }, [summary, byToolDays])

  const byToolTotal = useMemo(
    () => byToolView.reduce((s, r) => s + r.calls, 0),
    [byToolView],
  )

  const sparkMax = useMemo(() => {
    if (trendBuckets.length === 0) return 1
    const peak = Math.max(...trendBuckets.map((d) => d.calls), 0)
    return peak > 0 ? peak : 1
  }, [trendBuckets])

  // No reader injected (non-desktop host) — nothing to show.
  if (!reader) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <PageContent size="md">
          <Empty>{t("usage.label.noData")}</Empty>
        </PageContent>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-6" size="md">
          {error && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {error}
            </p>
          )}

          <HeroStats summary={summary} t={t} />

          <Section title={t("usage.tools.section.activity")}>
            {heatmap.length > 0 ? (
              <ToolHeatmap cells={heatmap} t={t} language={language} />
            ) : (
              <Empty>{t("usage.label.noData")}</Empty>
            )}
          </Section>

          <Section
            title={t("usage.tools.section.trend")}
            trailing={
              <ChipSwitcher
                options={DAY_RANGES}
                value={trendDays}
                onChange={(d) => changeTrendRange(d)}
                formatLabel={(d) => dayRangeLabel(d, t)}
              />
            }
          >
            {trendBuckets.some((d) => d.calls > 0) ? (
              <ul className="space-y-1">
                {trendBuckets.map((day) => (
                  <li
                    key={day.day}
                    className="grid grid-cols-[52px,80px,1fr,80px] items-center gap-3 text-sm"
                  >
                    <span className="whitespace-nowrap font-mono tabular-nums text-muted-foreground/80">
                      {formatMonthDay(day.day)}
                    </span>
                    <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {t("usage.tools.label.calls", { count: String(day.calls) })}
                    </span>
                    <SparkBar value={day.calls} max={sparkMax} />
                    <span className="text-right tabular-nums">
                      {day.calls === 0 ? "—" : formatCount(day.calls)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t("usage.label.noData")}</Empty>
            )}
          </Section>

          <Section
            title={t("usage.tools.section.byTool")}
            trailing={
              <ChipSwitcher
                options={DAY_RANGES}
                value={byToolDays}
                onChange={(d) => changeByToolRange(d)}
                formatLabel={(d) => dayRangeLabel(d, t)}
              />
            }
          >
            {byToolView.length > 0 ? (
              <ul className="space-y-1.5">
                {byToolView.map((tool) => (
                  <ToolRow
                    key={tool.tool}
                    tool={tool}
                    total={byToolTotal}
                    t={t}
                  />
                ))}
              </ul>
            ) : (
              <Empty>{t("usage.label.noData")}</Empty>
            )}
          </Section>

          <Section title={t("usage.tools.section.recent")}>
            {recent.length > 0 ? (
              <ul className="divide-y divide-border/40 rounded-md border border-border/40">
                {recent.map((inv) => (
                  <li
                    key={inv.toolCallId}
                    className="grid grid-cols-[44px,72px,1fr,72px] items-center gap-2 px-2 py-1 text-sm"
                  >
                    <span className="font-mono text-muted-foreground">
                      {formatClock(inv.ts)}
                    </span>
                    <span className="font-mono text-muted-foreground/70">
                      {formatShortSession(inv.sessionId)}
                    </span>
                    <span className="truncate font-mono text-foreground/90">
                      {inv.tool}
                    </span>
                    <span
                      className={cn(
                        "text-right tabular-nums",
                        !inv.completed && "text-muted-foreground/70 italic",
                      )}
                    >
                      {formatDuration(inv.durationMs, t)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t("usage.label.noData")}</Empty>
            )}
          </Section>

          <p className="pt-2 text-center text-xs text-muted-foreground/60">
            {t("usage.tools.footer.source")}
          </p>
        </PageContent>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  trailing,
  children,
}: {
  title: string
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
        {trailing}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground/70">{children}</p>
}

function HeroStats({
  summary,
  t,
}: {
  summary: MeterSummary | null
  t: TranslateFn
}) {
  const today = summary?.today
  return (
    <div className="grid grid-cols-3 gap-2">
      <HeroCard label={t("usage.tools.hero.calls")} value={today ? String(today.calls) : "0"} />
      <HeroCard
        label={t("usage.tools.hero.tools")}
        value={today ? String(today.distinctTools) : "0"}
      />
      <HeroCard
        label={t("usage.tools.hero.unfinished")}
        value={today ? String(today.unfinished) : "0"}
      />
    </div>
  )
}

function HeroCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <p className="truncate text-lg font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

function ToolRow({
  tool,
  total,
  t,
}: {
  tool: { tool: string; calls: number }
  total: number
  t: TranslateFn
}) {
  const pct = total > 0 ? Math.round((tool.calls / total) * 100) : 0
  return (
    <li className="space-y-0.5 text-sm">
      <div className="grid grid-cols-[1fr,80px,40px] items-center gap-2">
        <span className="truncate font-mono text-foreground/90">{tool.tool}</span>
        <span className="text-right tabular-nums">
          {t("usage.tools.label.calls", { count: String(tool.calls) })}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">
          {total > 0 ? t("usage.label.percentage", { pct: String(pct) }) : "—"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-sm bg-primary/70"
          style={{
            width: `${total > 0 ? Math.min(100, (tool.calls / total) * 100) : 0}%`,
          }}
        />
      </div>
    </li>
  )
}

function SparkBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 rounded-sm bg-muted">
      <div
        className={cn("h-full rounded-sm bg-primary/70 transition-[width]")}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function ToolHeatmap({
  cells,
  t,
  language,
}: {
  cells: ToolHeatmapCell[]
  t: TranslateFn
  language: string
}) {
  const isZh = (language ?? "").toLowerCase().startsWith("zh")
  return (
    <Heatmap
      cells={cells}
      formatValue={(c) => `${formatCount(c.value)} ${t("usage.tools.heatmap.tooltip.calls")}`}
      renderDetail={(c) =>
        c.toolBreakdown.length > 1 ? (
          <ul className="space-y-0.5">
            {c.toolBreakdown.map((tool) => (
              <li
                key={tool.tool}
                className="flex items-center justify-between gap-3 font-mono"
              >
                <span className="text-sm text-foreground/90">{tool.tool}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatCount(tool.calls)}
                </span>
              </li>
            ))}
          </ul>
        ) : null
      }
      dowLabels={{
        mon: t("usage.heatmap.dow.mon"),
        wed: t("usage.heatmap.dow.wed"),
        fri: t("usage.heatmap.dow.fri"),
      }}
      emptyLabel={t("usage.heatmap.tooltip.none")}
      emptyStateLabel={t("usage.label.noData")}
      legend={{ less: t("usage.heatmap.legend.less"), more: t("usage.heatmap.legend.more") }}
      monthNames={isZh ? MONTH_NAMES_ZH : undefined}
      dowLabelWidth={isZh ? 18 : 16}
    />
  )
}
