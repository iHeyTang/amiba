/**
 * Tool Activity panel — same layout vocabulary as token-meter.
 *   • Hero trio    — Today: calls / distinct tools / unfinished
 *   • Activity     — heatmap of daily call density
 *   • Trend        — last N days of call volume + sparkline
 *   • By tool      — bar chart of share by tool, N-day window
 *   • Recent calls — newest-first list with duration / status
 */

import { Loader2, RefreshCw, Wrench } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button, ChipSwitcher, cn, Heatmap, ScrollArea } from "@hermes-x/ui"

import { hermes } from "../../shared/hermes-bridge"
import { useT, useTheme } from "../../shared/i18n"
import type {
  DayBucket,
  HeatmapCell,
  HeatmapToolShare,
  MeterSummary,
  ToolInvocation,
  ToolPerDay,
} from "../../shared/types"

const RECENT_LIMIT = 30
const HEATMAP_RANGES = [12, 26, 52] as const
type HeatmapRange = (typeof HEATMAP_RANGES)[number]
const HEATMAP_DEFAULT_RANGE: HeatmapRange = 12
const HEATMAP_RANGE_SETTING_KEY = "ui.heatmap.weeks"
const DAY_RANGES = [1, 3, 7] as const
type DayRange = (typeof DAY_RANGES)[number]
const TREND_RANGE_SETTING_KEY = "ui.trend.days"
const BYTOOL_RANGE_SETTING_KEY = "ui.bytool.days"
const AUTO_REFRESH_INTERVAL_MS = 30_000
const CONTENT_MAX_W_CLASS = "max-w-2xl"

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

function formatDuration(ms: number | undefined, t: ReturnType<typeof useT>): string {
  if (ms === undefined) return t("label.running")
  return t("label.completed", { ms: String(Math.round(ms)) })
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

function dayRangeLabel(n: DayRange, t: ReturnType<typeof useT>): string {
  return n === 1 ? t("range.today") : t("range.lastN", { n: String(n) })
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  useTheme()
  const t = useT()

  const [summary, setSummary] = useState<MeterSummary | null>(null)
  const [recent, setRecent] = useState<ToolInvocation[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [heatmapWeeks, setHeatmapWeeks] = useState<HeatmapRange>(HEATMAP_DEFAULT_RANGE)
  const [trendDays, setTrendDays] = useState<DayRange>(7)
  const [byToolDays, setByToolDays] = useState<DayRange>(7)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void hermes.settings
      .get<HeatmapRange>(HEATMAP_RANGE_SETTING_KEY, HEATMAP_DEFAULT_RANGE)
      .then((stored) => {
        if (HEATMAP_RANGES.includes(stored)) setHeatmapWeeks(stored)
      })
    void hermes.settings
      .get<DayRange>(TREND_RANGE_SETTING_KEY, 7)
      .then((stored) => {
        if (DAY_RANGES.includes(stored)) setTrendDays(stored)
      })
    void hermes.settings
      .get<DayRange>(BYTOOL_RANGE_SETTING_KEY, 7)
      .then((stored) => {
        if (DAY_RANGES.includes(stored)) setByToolDays(stored)
      })
  }, [])

  const refresh = useCallback(
    async (weeks: HeatmapRange = heatmapWeeks) => {
      setLoading(true)
      setError(null)
      try {
        const [s, r, h] = await Promise.all([
          hermes.ipc.invoke<MeterSummary>("meter.summary"),
          hermes.ipc.invoke<ToolInvocation[]>("meter.recent", { limit: RECENT_LIMIT }),
          hermes.ipc.invoke<HeatmapCell[]>("meter.heatmap", { weeks }),
        ])
        setSummary(s)
        setRecent(r)
        setHeatmap(h)
      } catch (e) {
        setError((e as Error).message ?? String(e))
      } finally {
        setLoading(false)
      }
    },
    [heatmapWeeks],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh()
    }, AUTO_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const changeHeatmapRange = useCallback(
    async (weeks: HeatmapRange) => {
      if (weeks === heatmapWeeks) return
      setHeatmapWeeks(weeks)
      await hermes.settings.set(HEATMAP_RANGE_SETTING_KEY, weeks)
      void refresh(weeks)
    },
    [heatmapWeeks, refresh],
  )

  const changeTrendRange = useCallback(
    async (days: DayRange) => {
      if (days === trendDays) return
      setTrendDays(days)
      await hermes.settings.set(TREND_RANGE_SETTING_KEY, days)
    },
    [trendDays],
  )

  const changeByToolRange = useCallback(
    async (days: DayRange) => {
      if (days === byToolDays) return
      setByToolDays(days)
      await hermes.settings.set(BYTOOL_RANGE_SETTING_KEY, days)
    },
    [byToolDays],
  )

  const trendBuckets = useMemo<DayBucket[]>(() => {
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex shrink-0">
        <div
          className={cn(
            "mx-auto flex w-full items-center gap-2 px-4 py-2.5",
            CONTENT_MAX_W_CLASS,
          )}
        >
          <Wrench className="h-3.5 w-3.5 text-primary" />
          <h1 className="flex-1 text-xs font-semibold tracking-tight">{t("title")}</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-6 w-6 p-0"
            title={t("action.refresh")}
            aria-label={t("action.refresh")}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            "mx-auto w-full space-y-6 px-4 py-4",
            CONTENT_MAX_W_CLASS,
          )}
        >
          {error && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {error}
            </p>
          )}

          <HeroStats summary={summary} t={t} />

          <Section
            title={t("section.activity")}
            trailing={
              <ChipSwitcher
                options={HEATMAP_RANGES}
                value={heatmapWeeks}
                onChange={(w) => void changeHeatmapRange(w)}
                formatLabel={(w) => t("heatmap.range", { weeks: String(w) })}
              />
            }
          >
            {heatmap.length > 0 ? (
              <ToolHeatmap cells={heatmap} t={t} />
            ) : (
              <Empty>{t("label.noData")}</Empty>
            )}
          </Section>

          <Section
            title={t("section.trend")}
            trailing={
              <ChipSwitcher
                options={DAY_RANGES}
                value={trendDays}
                onChange={(d) => void changeTrendRange(d)}
                formatLabel={(d) => dayRangeLabel(d, t)}
              />
            }
          >
            {trendBuckets.some((d) => d.calls > 0) ? (
              <ul className="space-y-1">
                {trendBuckets.map((day) => (
                  <li
                    key={day.day}
                    className="grid grid-cols-[40px,80px,1fr,80px] items-center gap-3 text-[11px]"
                  >
                    <span className="font-mono text-muted-foreground/80">
                      {formatMonthDay(day.day)}
                    </span>
                    <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {t("label.calls", { count: String(day.calls) })}
                    </span>
                    <SparkBar value={day.calls} max={sparkMax} />
                    <span className="text-right tabular-nums">
                      {day.calls === 0 ? "—" : formatCount(day.calls)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t("label.noData")}</Empty>
            )}
          </Section>

          <Section
            title={t("section.byTool")}
            trailing={
              <ChipSwitcher
                options={DAY_RANGES}
                value={byToolDays}
                onChange={(d) => void changeByToolRange(d)}
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
              <Empty>{t("label.noData")}</Empty>
            )}
          </Section>

          <Section title={t("section.recent")}>
            {recent.length > 0 ? (
              <ul className="divide-y divide-border/40 rounded-md border border-border/40">
                {recent.map((inv) => (
                  <li
                    key={inv.toolCallId}
                    className="grid grid-cols-[44px,72px,1fr,72px] items-center gap-2 px-2 py-1 text-[11px]"
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
              <Empty>{t("label.noData")}</Empty>
            )}
          </Section>

          <p className="pt-2 text-center text-[10px] text-muted-foreground/60">
            {t("footer.source")}
          </p>
        </div>
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
        <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
        {trailing}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground/70">{children}</p>
}

function HeroStats({
  summary,
  t,
}: {
  summary: MeterSummary | null
  t: ReturnType<typeof useT>
}) {
  const today = summary?.today
  return (
    <div className="grid grid-cols-3 gap-2">
      <HeroCard label={t("hero.calls")} value={today ? String(today.calls) : "0"} />
      <HeroCard
        label={t("hero.tools")}
        value={today ? String(today.distinctTools) : "0"}
      />
      <HeroCard
        label={t("hero.unfinished")}
        value={today ? String(today.unfinished) : "0"}
      />
    </div>
  )
}

function HeroCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <p className="truncate text-lg font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
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
  t: ReturnType<typeof useT>
}) {
  const pct = total > 0 ? Math.round((tool.calls / total) * 100) : 0
  return (
    <li className="space-y-0.5 text-[11px]">
      <div className="grid grid-cols-[1fr,80px,40px] items-center gap-2">
        <span className="truncate font-mono text-foreground/90">{tool.tool}</span>
        <span className="text-right tabular-nums">
          {t("label.calls", { count: String(tool.calls) })}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">
          {total > 0 ? t("label.percentage", { pct: String(pct) }) : "—"}
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
}: {
  cells: HeatmapCell[]
  t: ReturnType<typeof useT>
}) {
  const isZh = (hermes.language ?? "").toLowerCase().startsWith("zh")
  return (
    <Heatmap
      cells={cells}
      formatValue={(c) => `${formatCount(c.value)} ${t("heatmap.tooltip.calls")}`}
      renderDetail={(c) =>
        c.toolBreakdown.length > 1 ? (
          <ul className="space-y-0.5">
            {c.toolBreakdown.map((tool) => (
              <li
                key={tool.tool}
                className="flex items-center justify-between gap-3 font-mono"
              >
                <span className="text-[10px] text-foreground/90">{tool.tool}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatCount(tool.calls)}
                </span>
              </li>
            ))}
          </ul>
        ) : null
      }
      dowLabels={{
        mon: t("heatmap.dow.mon"),
        wed: t("heatmap.dow.wed"),
        fri: t("heatmap.dow.fri"),
      }}
      emptyLabel={t("heatmap.tooltip.none")}
      emptyStateLabel={t("label.noData")}
      legend={{ less: t("heatmap.legend.less"), more: t("heatmap.legend.more") }}
      monthNames={isZh ? MONTH_NAMES_ZH : undefined}
      dowLabelWidth={isZh ? 18 : 16}
    />
  )
}

// Keep imports referenced so tsc doesn't flag them as unused — these
// types only appear in IPC contract docs / future expansion.
void undefined as unknown as HeatmapToolShare
void undefined as unknown as ToolPerDay
