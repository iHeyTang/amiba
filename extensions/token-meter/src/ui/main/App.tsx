/**
 * Token usage panel.
 *
 * Layout (top → bottom):
 *   • Hero stat trio    — today: tokens / turns / sessions
 *   • Activity heatmap  — 12 / 26 / 52 weeks; hover for per-day model breakdown
 *   • Last 7 days       — aligned columns
 *   • By model (today)  — horizontal bar chart of token share
 *   • Recent sessions   — newest-first list
 *
 * No cost / USD anywhere — billing plans differ enough that any single
 * dollar number we'd display would be wrong for someone. Tokens are
 * the exact, plan-independent measurement.
 */

import { Loader2, RefreshCw, Wallet } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button, ChipSwitcher, cn, Heatmap, ScrollArea } from "@hermes-x/ui"

import { hermes } from "../../shared/hermes-bridge"
import { useT, useTheme } from "../../shared/i18n"
import type {
  DayBucket,
  HeatmapCell,
  HeatmapModelShare,
  MeterSummary,
  ModelPerDay,
  TurnUsage,
} from "../../shared/types"

const RECENT_LIMIT = 20
const HEATMAP_RANGES = [12, 26, 52] as const
type HeatmapRange = (typeof HEATMAP_RANGES)[number]
const HEATMAP_DEFAULT_RANGE: HeatmapRange = 12
const HEATMAP_RANGE_SETTING_KEY = "ui.heatmap.weeks"
/** Day-range options shared by the "Recent activity" and "By model"
 *  sections — 1 / 3 / 7 calendar days. Stored separately per section
 *  so the user can compare today's model split against the 7-day
 *  trend without resetting both. */
const DAY_RANGES = [1, 3, 7] as const
type DayRange = (typeof DAY_RANGES)[number]
const TREND_RANGE_SETTING_KEY = "ui.trend.days"
const BYMODEL_RANGE_SETTING_KEY = "ui.bymodel.days"
const AUTO_REFRESH_INTERVAL_MS = 30_000
const CONTENT_MAX_W_CLASS = "max-w-2xl"

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`
  if (n >= 1_000) return `${(n / 1000).toFixed(2)}K`
  return String(n)
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

/**
 * True for values hermes-agent records when the client never pinned a
 * specific model — empty/whitespace, the routing placeholder
 * "hermes-agent", and the runner-side "(unknown)" grouping sentinel.
 */
function isPlaceholderModel(name: string | undefined | null): boolean {
  if (!name) return true
  const norm = name.trim().toLowerCase()
  return norm === "" || norm === "hermes-agent" || norm === "(unknown)"
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  useTheme()
  const t = useT()

  const [summary, setSummary] = useState<MeterSummary | null>(null)
  const [recent, setRecent] = useState<TurnUsage[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [heatmapWeeks, setHeatmapWeeks] = useState<HeatmapRange>(HEATMAP_DEFAULT_RANGE)
  const [trendDays, setTrendDays] = useState<DayRange>(7)
  const [byModelDays, setByModelDays] = useState<DayRange>(7)
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
      .get<DayRange>(BYMODEL_RANGE_SETTING_KEY, 7)
      .then((stored) => {
        if (DAY_RANGES.includes(stored)) setByModelDays(stored)
      })
  }, [])

  const refresh = useCallback(
    async (weeks: HeatmapRange = heatmapWeeks) => {
      setLoading(true)
      setError(null)
      try {
        const [s, r, h] = await Promise.all([
          hermes.ipc.invoke<MeterSummary>("meter.summary"),
          hermes.ipc.invoke<TurnUsage[]>("meter.recent", { limit: RECENT_LIMIT }),
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

  const changeByModelRange = useCallback(
    async (days: DayRange) => {
      if (days === byModelDays) return
      setByModelDays(days)
      await hermes.settings.set(BYMODEL_RANGE_SETTING_KEY, days)
    },
    [byModelDays],
  )

  // Derived: the visible slice of last7Days (newest first).
  const trendBuckets = useMemo<DayBucket[]>(() => {
    if (!summary) return []
    return summary.last7Days.slice(0, trendDays)
  }, [summary, trendDays])

  // Derived: per-model totals collapsed across the chosen window. We
  // re-sort here because a model that dominates over 7 days isn't
  // necessarily the leader today.
  const byModelView = useMemo(() => {
    if (!summary) return [] as Array<{ model: string; totalTokens: number }>
    const rows = summary.byModelLast7.map((m) => {
      const slice = m.perDay.slice(0, byModelDays)
      const totalTokens = slice.reduce((s, d) => s + d.totalTokens, 0)
      return { model: m.model, totalTokens }
    })
    return rows
      .filter((r) => r.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens)
  }, [summary, byModelDays])

  const byModelTotal = useMemo(
    () => byModelView.reduce((s, r) => s + r.totalTokens, 0),
    [byModelView],
  )

  const sparkMax = useMemo(() => {
    if (trendBuckets.length === 0) return 1
    const peak = Math.max(...trendBuckets.map((d) => d.totalTokens), 0)
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
          <Wallet className="h-3.5 w-3.5 text-primary" />
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

          {/* Hero stat trio — today only */}
          <HeroStats summary={summary} t={t} />

          {/* Activity heatmap */}
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
              <TokenHeatmap cells={heatmap} t={t} />
            ) : (
              <Empty>{t("label.noData")}</Empty>
            )}
          </Section>

          {/* Recent activity (today / 3d / 7d) */}
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
            {trendBuckets.some((d) => d.totalTokens > 0) ? (
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
                      {t("label.turns", { count: String(day.turns) })}
                    </span>
                    <SparkBar value={day.totalTokens} max={sparkMax} />
                    <span className="text-right tabular-nums">
                      {day.totalTokens === 0 ? "—" : formatTokens(day.totalTokens)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{t("label.noData")}</Empty>
            )}
          </Section>

          {/* By model (today / 3d / 7d) */}
          <Section
            title={t("section.byModel")}
            trailing={
              <ChipSwitcher
                options={DAY_RANGES}
                value={byModelDays}
                onChange={(d) => void changeByModelRange(d)}
                formatLabel={(d) => dayRangeLabel(d, t)}
              />
            }
          >
            {byModelView.length > 0 ? (
              <ul className="space-y-1.5">
                {byModelView.map((m) => (
                  <ModelRow
                    key={m.model}
                    model={m}
                    totalTokens={byModelTotal}
                    t={t}
                  />
                ))}
              </ul>
            ) : (
              <Empty>{t("label.noData")}</Empty>
            )}
          </Section>

          {/* Recent sessions */}
          <Section title={t("section.recent")}>
            {recent.length > 0 ? (
              <ul className="divide-y divide-border/40 rounded-md border border-border/40">
                {recent.map((turn) => (
                  <li
                    key={`${turn.ts}-${turn.sessionId ?? "n"}`}
                    className="grid grid-cols-[44px,72px,1fr,72px] items-center gap-2 px-2 py-1 text-[11px]"
                  >
                    <span className="font-mono text-muted-foreground">
                      {formatClock(turn.ts)}
                    </span>
                    <span className="font-mono text-muted-foreground/70">
                      {formatShortSession(turn.sessionId)}
                    </span>
                    <ModelLabel
                      name={turn.model}
                      t={t}
                      className="truncate text-foreground/90"
                    />
                    <span className="text-right tabular-nums">
                      {formatTokens(turn.totalTokens)}
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

function ModelLabel({
  name,
  className,
  t,
}: {
  name: string | undefined | null
  className?: string
  t: ReturnType<typeof useT>
}) {
  if (!isPlaceholderModel(name)) {
    return <span className={cn("font-mono", className)}>{name}</span>
  }
  return (
    <span
      title={t("label.placeholderHint")}
      className={cn("font-mono italic text-muted-foreground/80", className)}
    >
      {t("label.placeholder")}
    </span>
  )
}

function dayRangeLabel(n: DayRange, t: ReturnType<typeof useT>): string {
  return n === 1 ? t("range.today") : t("range.lastN", { n: String(n) })
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
      <HeroCard
        label={t("hero.tokens")}
        value={today ? formatTokens(today.totalTokens) : "0"}
      />
      <HeroCard
        label={t("hero.turns")}
        value={today ? String(today.turns) : "0"}
      />
      <HeroCard
        label={t("hero.sessions")}
        value={today ? String(today.sessions) : "0"}
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

function ModelRow({
  model,
  totalTokens,
  t,
}: {
  model: { model: string; totalTokens: number }
  /** Denominator for the bar / percentage — total tokens across all
   *  models in the current view window. */
  totalTokens: number
  t: ReturnType<typeof useT>
}) {
  const pct = totalTokens > 0 ? Math.round((model.totalTokens / totalTokens) * 100) : 0
  return (
    <li className="space-y-0.5 text-[11px]">
      <div className="grid grid-cols-[1fr,80px,40px] items-center gap-2">
        <ModelLabel
          name={model.model}
          t={t}
          className="truncate text-foreground/90"
        />
        <span className="text-right tabular-nums">{formatTokens(model.totalTokens)}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {totalTokens > 0 ? t("label.percentage", { pct: String(pct) }) : "—"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full rounded-sm bg-primary/70"
          style={{
            width: `${totalTokens > 0 ? Math.min(100, (model.totalTokens / totalTokens) * 100) : 0}%`,
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


// ---------------------------------------------------------------------------
// Token-meter heatmap wrapper
//
// Adapts the runner's HeatmapCell (carrying per-model breakdown) into
// what the shared @hermes-x/ui Heatmap expects, and renders the
// per-model detail list in the popover.
// ---------------------------------------------------------------------------

const MONTH_NAMES_ZH = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
]

function TokenHeatmap({
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
      formatValue={(c) => `${formatTokens(c.value)} ${t("heatmap.tooltip.tokens")}`}
      renderDetail={(c) =>
        c.modelBreakdown.length > 1 ? (
          <ul className="space-y-0.5">
            {c.modelBreakdown.map((m) => (
              <li
                key={m.model}
                className="flex items-center justify-between gap-3 font-mono"
              >
                <ModelLabel
                  name={m.model}
                  t={t}
                  className="text-[10px] text-foreground/90"
                />
                <span className="tabular-nums text-muted-foreground">
                  {formatTokens(m.tokens)}
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
