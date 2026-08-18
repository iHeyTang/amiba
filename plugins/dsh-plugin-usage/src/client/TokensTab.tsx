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
 * Content only — the settings-section head (title, scroll host) is owned
 * by the Settings shell; this component supplies its own ScrollArea, same
 * as every other migrated settings section. Freshness is app-guaranteed:
 * load on mount, refetch on window focus, and a 30 s poll while mounted
 * (usage is remote — no push channel).
 */

import {
  cn,
  ChipSwitcher,
  Heatmap,
  PageContent,
  ScrollArea,
  usePluginT,
  useRefetchOnFocus,
  type PluginLanguage,
} from "@amiba/ui/plugin";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readUsagePref, writeUsagePref } from "./prefs.js";
import {
  fetchTokenHeatmap,
  fetchTokenRecent,
  fetchTokenSummary,
  type DayBucket,
  type MeterSummary,
  type TokenHeatmapCell,
  type TurnUsage,
  type UsageListFn,
} from "./token-usage.js";

const RECENT_LIMIT = 20;
const HEATMAP_WEEKS = 52;
/** Day-range options shared by the "Recent activity" and "By model"
 *  sections — 1 / 3 / 7 calendar days. Stored separately per section
 *  so the user can compare today's model split against the 7-day
 *  trend without resetting both. */
const DAY_RANGES = [1, 3, 7] as const;
type DayRange = (typeof DAY_RANGES)[number];
const TREND_RANGE_SETTING_KEY = "usage.tokens.ui.trend.days";
const BYMODEL_RANGE_SETTING_KEY = "usage.tokens.ui.bymodel.days";
const AUTO_REFRESH_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Plugin-owned copy (i18n) — mirrors the host `usage.*` strings this view
// used to read via `useT()`. The host keys stay put (deleted only in the
// final purge sweep once every consumer, including `ToolsActivityTab`, has
// moved) — this is a deliberate duplicate, not a shared import.
// ---------------------------------------------------------------------------

const ZH = {
  nav: "用量",
  sectionActivity: "活跃度",
  sectionTrend: "用量趋势",
  sectionByModel: "按模型",
  sectionRecent: "最近会话",
  footerSource: "数据来自本地运行环境 · 每 30 秒自动刷新",
  heroTokens: "Tokens",
  heroTurns: "Turns",
  heroSessions: "会话",
  noData: "暂无数据。",
  percentage: (pct: string) => `${pct}%`,
  turnsLabel: (count: string) => `${count} turns`,
  placeholder: "未知",
  placeholderHint: "这个会话的 DSH 事件历史没有记录具体模型。",
  heatmapTooltipTokens: "tokens",
  heatmapDowMon: "一",
  heatmapDowWed: "三",
  heatmapDowFri: "五",
  heatmapTooltipNone: "无活动",
  heatmapLegendLess: "少",
  heatmapLegendMore: "多",
  rangeToday: "今天",
  rangeLastN: (n: string) => `${n} 天`,
};

const EN: typeof ZH = {
  // Section label. "Usage", not "Tokens": since T9 the section hosts both
  // the Tokens and Tools views (zh-CN already said 用量 = usage).
  nav: "Usage",
  sectionActivity: "Activity",
  sectionTrend: "Activity trend",
  sectionByModel: "By model",
  sectionRecent: "Recent sessions",
  footerSource: "Data from the local runtime · auto-refreshes every 30 s",
  heroTokens: "Tokens",
  heroTurns: "Turns",
  heroSessions: "Sessions",
  noData: "No data yet.",
  percentage: (pct) => `${pct}%`,
  turnsLabel: (count) => `${count} turns`,
  placeholder: "Unknown",
  placeholderHint:
    "The DSH event history for this session did not record a specific model.",
  heatmapTooltipTokens: "tokens",
  heatmapDowMon: "M",
  heatmapDowWed: "W",
  heatmapDowFri: "F",
  heatmapTooltipNone: "no activity",
  heatmapLegendLess: "Less",
  heatmapLegendMore: "More",
  rangeToday: "Today",
  rangeLastN: (n) => `${n}d`,
};

export function labels(language?: PluginLanguage): typeof ZH {
  const resolved =
    language ??
    (document.documentElement.lang.toLowerCase().startsWith("zh")
      ? "zh-CN"
      : "en");
  return resolved === "zh-CN" ? ZH : EN;
}

type Copy = typeof ZH;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(2)}K`;
  return String(n);
}

function formatShortSession(id: string | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatMonthDay(day: string): string {
  return day.slice(5);
}

/**
 * True for values recorded before the runtime could identify a model.
 */
function isPlaceholderModel(name: string | undefined | null): boolean {
  if (!name) return true;
  const norm = name.trim().toLowerCase();
  return norm === "" || norm === "(unknown)";
}

// ---------------------------------------------------------------------------
// TokensTab
// ---------------------------------------------------------------------------

export function TokensTab({ list }: { list: UsageListFn }) {
  const { language } = usePluginT();
  const copy = labels(language);

  const [summary, setSummary] = useState<MeterSummary | null>(null);
  const [recent, setRecent] = useState<TurnUsage[]>([]);
  const [heatmap, setHeatmap] = useState<TokenHeatmapCell[]>([]);
  const [trendDays, setTrendDays] = useState<DayRange>(7);
  const [byModelDays, setByModelDays] = useState<DayRange>(7);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readUsagePref<DayRange>(TREND_RANGE_SETTING_KEY, 7).then((stored) => {
      if (DAY_RANGES.includes(stored)) setTrendDays(stored);
    });
    void readUsagePref<DayRange>(BYMODEL_RANGE_SETTING_KEY, 7).then((stored) => {
      if (DAY_RANGES.includes(stored)) setByModelDays(stored);
    });
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, r, h] = await Promise.all([
        fetchTokenSummary(list),
        fetchTokenRecent(list, RECENT_LIMIT),
        fetchTokenHeatmap(list, HEATMAP_WEEKS),
      ]);
      setSummary(s);
      setRecent(r);
      setHeatmap(h);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  }, [list]);

  // Load the fixed annual heatmap on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh();
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useRefetchOnFocus(() => void refresh());

  const changeTrendRange = useCallback(
    async (days: DayRange) => {
      if (days === trendDays) return;
      setTrendDays(days);
      writeUsagePref(TREND_RANGE_SETTING_KEY, days);
    },
    [trendDays],
  );

  const changeByModelRange = useCallback(
    async (days: DayRange) => {
      if (days === byModelDays) return;
      setByModelDays(days);
      writeUsagePref(BYMODEL_RANGE_SETTING_KEY, days);
    },
    [byModelDays],
  );

  // Derived: the visible slice of last7Days (newest first).
  const trendBuckets = useMemo<DayBucket[]>(() => {
    if (!summary) return [];
    return summary.last7Days.slice(0, trendDays);
  }, [summary, trendDays]);

  // Derived: per-model totals collapsed across the chosen window. We
  // re-sort here because a model that dominates over 7 days isn't
  // necessarily the leader today.
  const byModelView = useMemo(() => {
    if (!summary) return [] as Array<{ model: string; totalTokens: number }>;
    const rows = summary.byModelLast7.map((m) => {
      const slice = m.perDay.slice(0, byModelDays);
      const totalTokens = slice.reduce((s, d) => s + d.totalTokens, 0);
      return { model: m.model, totalTokens };
    });
    return rows
      .filter((r) => r.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [summary, byModelDays]);

  const byModelTotal = useMemo(
    () => byModelView.reduce((s, r) => s + r.totalTokens, 0),
    [byModelView],
  );

  const sparkMax = useMemo(() => {
    if (trendBuckets.length === 0) return 1;
    const peak = Math.max(...trendBuckets.map((d) => d.totalTokens), 0);
    return peak > 0 ? peak : 1;
  }, [trendBuckets]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-6" size="md">
          {error && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {error}
            </p>
          )}

          {/* Hero stat trio — today only */}
          <HeroStats summary={summary} copy={copy} />

          {/* Activity heatmap */}
          <Section title={copy.sectionActivity}>
            {heatmap.length > 0 ? (
              <TokenHeatmap cells={heatmap} copy={copy} language={language} />
            ) : (
              <Empty>{copy.noData}</Empty>
            )}
          </Section>

          {/* Recent activity (today / 3d / 7d) */}
          <Section
            title={copy.sectionTrend}
            trailing={
              <ChipSwitcher
                options={DAY_RANGES}
                value={trendDays}
                onChange={(d) => void changeTrendRange(d)}
                formatLabel={(d) => dayRangeLabel(d, copy)}
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
                      {copy.turnsLabel(String(day.turns))}
                    </span>
                    <SparkBar value={day.totalTokens} max={sparkMax} />
                    <span className="text-right tabular-nums">
                      {day.totalTokens === 0 ? "—" : formatTokens(day.totalTokens)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{copy.noData}</Empty>
            )}
          </Section>

          {/* By model (today / 3d / 7d) */}
          <Section
            title={copy.sectionByModel}
            trailing={
              <ChipSwitcher
                options={DAY_RANGES}
                value={byModelDays}
                onChange={(d) => void changeByModelRange(d)}
                formatLabel={(d) => dayRangeLabel(d, copy)}
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
                    copy={copy}
                  />
                ))}
              </ul>
            ) : (
              <Empty>{copy.noData}</Empty>
            )}
          </Section>

          {/* Recent sessions */}
          <Section title={copy.sectionRecent}>
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
                      copy={copy}
                      className="truncate text-foreground/90"
                    />
                    <span className="text-right tabular-nums">
                      {formatTokens(turn.totalTokens)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>{copy.noData}</Empty>
            )}
          </Section>

          <p className="pt-2 text-center text-xs text-muted-foreground/60">
            {copy.footerSource}
          </p>
        </PageContent>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
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
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground/70">{children}</p>;
}

function ModelLabel({
  name,
  className,
  copy,
}: {
  name: string | undefined | null;
  className?: string;
  copy: Copy;
}) {
  if (!isPlaceholderModel(name)) {
    return <span className={cn("font-mono", className)}>{name}</span>;
  }
  return (
    <span
      title={copy.placeholderHint}
      className={cn("font-mono italic text-muted-foreground/80", className)}
    >
      {copy.placeholder}
    </span>
  );
}

function dayRangeLabel(n: DayRange, copy: Copy): string {
  return n === 1 ? copy.rangeToday : copy.rangeLastN(String(n));
}

function HeroStats({
  summary,
  copy,
}: {
  summary: MeterSummary | null;
  copy: Copy;
}) {
  const today = summary?.today;
  return (
    <div className="grid grid-cols-3 gap-2">
      <HeroCard
        label={copy.heroTokens}
        value={today ? formatTokens(today.totalTokens) : "0"}
      />
      <HeroCard
        label={copy.heroTurns}
        value={today ? String(today.turns) : "0"}
      />
      <HeroCard
        label={copy.heroSessions}
        value={today ? String(today.sessions) : "0"}
      />
    </div>
  );
}

function HeroCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2.5">
      <p className="truncate text-lg font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function ModelRow({
  model,
  totalTokens,
  copy,
}: {
  model: { model: string; totalTokens: number };
  /** Denominator for the bar / percentage — total tokens across all
   *  models in the current view window. */
  totalTokens: number;
  copy: Copy;
}) {
  const pct = totalTokens > 0 ? Math.round((model.totalTokens / totalTokens) * 100) : 0;
  return (
    <li className="space-y-0.5 text-sm">
      <div className="grid grid-cols-[1fr,80px,40px] items-center gap-2">
        <ModelLabel
          name={model.model}
          copy={copy}
          className="truncate text-foreground/90"
        />
        <span className="text-right tabular-nums">{formatTokens(model.totalTokens)}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {totalTokens > 0 ? copy.percentage(String(pct)) : "—"}
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
  );
}

function SparkBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-sm bg-muted">
      <div
        className={cn("h-full rounded-sm bg-primary/70 transition-[width]")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
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
];

function TokenHeatmap({
  cells,
  copy,
  language,
}: {
  cells: TokenHeatmapCell[];
  copy: Copy;
  language: string;
}) {
  const isZh = (language ?? "").toLowerCase().startsWith("zh");
  return (
    <Heatmap
      cells={cells}
      formatValue={(c) => `${formatTokens(c.value)} ${copy.heatmapTooltipTokens}`}
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
                  copy={copy}
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
        mon: copy.heatmapDowMon,
        wed: copy.heatmapDowWed,
        fri: copy.heatmapDowFri,
      }}
      emptyLabel={copy.heatmapTooltipNone}
      emptyStateLabel={copy.noData}
      legend={{ less: copy.heatmapLegendLess, more: copy.heatmapLegendMore }}
      monthNames={isZh ? MONTH_NAMES_ZH : undefined}
      dowLabelWidth={isZh ? 18 : 16}
    />
  );
}
