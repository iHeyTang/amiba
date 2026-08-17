/**
 * Token usage tab.
 *
 * Layout (top → bottom):
 *   • Hero stat trio    — today: tokens / turns / sessions
 *   • Activity heatmap  — fixed 52-week view; hover for per-day model breakdown
 *   • Last 7 days       — aligned columns
 *   • By model (today)  — horizontal bar chart of token share
 *   • Recent sessions   — newest-first list
 *
 * No cost / USD anywhere — billing plans differ enough that any single
 * dollar number we'd display would be wrong for someone. Tokens are
 * the exact, plan-independent measurement.
 *
 * Pure scaffold content — the page-level head (title, scroll, width) is
 * provided by SettingsPageScaffold. Freshness is app-guaranteed: load on
 * mount, refetch on window focus, and a 30 s poll while mounted (the
 * session list is remote — no push channel).
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import { useT } from "@amiba/i18n"

import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus"
import { cn } from "../primitives"
import { ChipSwitcher, Heatmap } from "../viz"

import { readUsagePref, writeUsagePref } from "./prefs"
import {
  fetchTokenHeatmap,
  fetchTokenRecent,
  fetchTokenSummary,
  type DayBucket,
  type MeterSummary,
  type TokenHeatmapCell,
  type TurnUsage,
} from "./token-usage"

type TFunc = ReturnType<typeof useT>["t"]

const RECENT_LIMIT = 20
const HEATMAP_WEEKS = 52
/** Day-range options shared by the "Recent activity" and "By model"
 *  sections — 1 / 3 / 7 calendar days. Stored separately per section
 *  so the user can compare today's model split against the 7-day
 *  trend without resetting both. */
const DAY_RANGES = [1, 3, 7] as const
type DayRange = (typeof DAY_RANGES)[number]
const TREND_RANGE_SETTING_KEY = "usage.tokens.ui.trend.days"
const BYMODEL_RANGE_SETTING_KEY = "usage.tokens.ui.bymodel.days"
const AUTO_REFRESH_INTERVAL_MS = 30_000

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
 * True for values recorded before the runtime could identify a model.
 */
function isPlaceholderModel(name: string | undefined | null): boolean {
  if (!name) return true
  const norm = name.trim().toLowerCase()
  return norm === "" || norm === "(unknown)"
}

// ---------------------------------------------------------------------------
// TokensTab
// ---------------------------------------------------------------------------

export function TokensTab() {
  const { t, language } = useT()

  const [summary, setSummary] = useState<MeterSummary | null>(null)
  const [recent, setRecent] = useState<TurnUsage[]>([])
  const [heatmap, setHeatmap] = useState<TokenHeatmapCell[]>([])
  const [trendDays, setTrendDays] = useState<DayRange>(7)
  const [byModelDays, setByModelDays] = useState<DayRange>(7)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void readUsagePref<DayRange>(TREND_RANGE_SETTING_KEY, 7).then((stored) => {
      if (DAY_RANGES.includes(stored)) setTrendDays(stored)
    })
    void readUsagePref<DayRange>(BYMODEL_RANGE_SETTING_KEY, 7).then((stored) => {
      if (DAY_RANGES.includes(stored)) setByModelDays(stored)
    })
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [s, r, h] = await Promise.all([
        fetchTokenSummary(),
        fetchTokenRecent(RECENT_LIMIT),
        fetchTokenHeatmap(HEATMAP_WEEKS),
      ])
      setSummary(s)
      setRecent(r)
      setHeatmap(h)
    } catch (e) {
      setError((e as Error).message ?? String(e))
    }
  }, [])

  // Load the fixed annual heatmap on mount.
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh()
    }, AUTO_REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  useRefetchOnFocus(() => void refresh())

  const changeTrendRange = useCallback(
    async (days: DayRange) => {
      if (days === trendDays) return
      setTrendDays(days)
      writeUsagePref(TREND_RANGE_SETTING_KEY, days)
    },
    [trendDays],
  )

  const changeByModelRange = useCallback(
    async (days: DayRange) => {
      if (days === byModelDays) return
      setByModelDays(days)
      writeUsagePref(BYMODEL_RANGE_SETTING_KEY, days)
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
    <div className="space-y-6">
      {error && (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      {/* Hero stat trio — today only */}
      <HeroStats summary={summary} t={t} />

      {/* Activity heatmap */}
      <Section title={t("usage.tokens.section.activity")}>
        {heatmap.length > 0 ? (
          <TokenHeatmap cells={heatmap} t={t} language={language} />
        ) : (
          <Empty>{t("usage.label.noData")}</Empty>
        )}
      </Section>

      {/* Recent activity (today / 3d / 7d) */}
      <Section
        title={t("usage.tokens.section.trend")}
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
                className="grid grid-cols-[52px,80px,1fr,80px] items-center gap-3 text-sm"
              >
                <span className="whitespace-nowrap font-mono tabular-nums text-muted-foreground/80">
                  {formatMonthDay(day.day)}
                </span>
                <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {t("usage.tokens.label.turns", { count: String(day.turns) })}
                </span>
                <SparkBar value={day.totalTokens} max={sparkMax} />
                <span className="text-right tabular-nums">
                  {day.totalTokens === 0 ? "—" : formatTokens(day.totalTokens)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t("usage.label.noData")}</Empty>
        )}
      </Section>

      {/* By model (today / 3d / 7d) */}
      <Section
        title={t("usage.tokens.section.byModel")}
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
          <Empty>{t("usage.label.noData")}</Empty>
        )}
      </Section>

      {/* Recent sessions */}
      <Section title={t("usage.tokens.section.recent")}>
        {recent.length > 0 ? (
          <ul className="divide-y divide-border/40 rounded-md border border-border/40">
            {recent.map((turn) => (
              <li
                key={`${turn.ts}-${turn.sessionId ?? "n"}-${turn.turn ?? "t"}-${turn.step ?? "s"}`}
                className="grid grid-cols-[44px,72px,1fr,72px] items-center gap-2 px-2 py-1 text-sm"
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
          <Empty>{t("usage.label.noData")}</Empty>
        )}
      </Section>

      <p className="pt-2 text-center text-xs text-muted-foreground/60">
        {t("usage.tokens.footer.source")}
      </p>
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

function ModelLabel({
  name,
  className,
  t,
}: {
  name: string | undefined | null
  className?: string
  t: TFunc
}) {
  if (!isPlaceholderModel(name)) {
    return <span className={cn("font-mono", className)}>{name}</span>
  }
  return (
    <span
      title={t("usage.tokens.label.placeholderHint")}
      className={cn("font-mono italic text-muted-foreground/80", className)}
    >
      {t("usage.tokens.label.placeholder")}
    </span>
  )
}

function dayRangeLabel(n: DayRange, t: TFunc): string {
  return n === 1 ? t("usage.range.today") : t("usage.range.lastN", { n: String(n) })
}

function HeroStats({
  summary,
  t,
}: {
  summary: MeterSummary | null
  t: TFunc
}) {
  const today = summary?.today
  return (
    <div className="grid grid-cols-3 gap-2">
      <HeroCard
        label={t("usage.tokens.hero.tokens")}
        value={today ? formatTokens(today.totalTokens) : "0"}
      />
      <HeroCard
        label={t("usage.tokens.hero.turns")}
        value={today ? String(today.turns) : "0"}
      />
      <HeroCard
        label={t("usage.tokens.hero.sessions")}
        value={today ? String(today.sessions) : "0"}
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

function ModelRow({
  model,
  totalTokens,
  t,
}: {
  model: { model: string; totalTokens: number }
  /** Denominator for the bar / percentage — total tokens across all
   *  models in the current view window. */
  totalTokens: number
  t: TFunc
}) {
  const pct = totalTokens > 0 ? Math.round((model.totalTokens / totalTokens) * 100) : 0
  return (
    <li className="space-y-0.5 text-sm">
      <div className="grid grid-cols-[1fr,80px,40px] items-center gap-2">
        <ModelLabel
          name={model.model}
          t={t}
          className="truncate text-foreground/90"
        />
        <span className="text-right tabular-nums">{formatTokens(model.totalTokens)}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {totalTokens > 0 ? t("usage.label.percentage", { pct: String(pct) }) : "—"}
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
// Token heatmap wrapper
//
// Adapts TokenHeatmapCell (carrying per-model breakdown) into what the
// shared viz Heatmap expects, and renders the per-model detail list in
// the popover.
// ---------------------------------------------------------------------------

const MONTH_NAMES_ZH = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
]

function TokenHeatmap({
  cells,
  t,
  language,
}: {
  cells: TokenHeatmapCell[]
  t: TFunc
  language: string
}) {
  const isZh = (language ?? "").toLowerCase().startsWith("zh")
  return (
    <Heatmap
      cells={cells}
      formatValue={(c) => `${formatTokens(c.value)} ${t("usage.tokens.heatmap.tooltip.tokens")}`}
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
                  className="text-sm text-foreground/90"
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
