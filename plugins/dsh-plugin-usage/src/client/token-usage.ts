/**
 * Token-usage aggregation.
 *
 * Reads provider-reported usage from the canonical DSH event log through
 * the plugin's own `amibaUsage/list` Typert Remote (injected as `list` by
 * `../client/index.tsx`, which mounts `AMIBA_USAGE_REMOTE`).
 * There is no cost computation because account-specific billing cannot be
 * inferred from token counts.
 *
 * Cost / USD is intentionally absent: provider-reported cost numbers
 * depend on per-account plan terms (subscription-included, prepaid
 * credits, per-token rate cards) that this panel can't reason about
 * honestly. We surface tokens — the one number we can measure exactly
 * — and let the user reason about cost wherever billing actually
 * lives.
 */

import type { HeatmapCellBase } from "@amiba/ui/plugin";

import type { AmibaUsageListResult, AmibaUsageRecord } from "../remote.js";

/** Injected by the client entry — reads the plugin's own Typert Remote. */
export type UsageListFn = () => Promise<AmibaUsageListResult>;

// ---------------------------------------------------------------------------
// Wire types (token-specific; ported from the token-meter extension)
// ---------------------------------------------------------------------------

export interface TurnUsage {
  ts: number;
  sessionId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turn?: number;
  step?: number;
}

export interface BucketTotals {
  turns: number;
  sessions: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface DayBucket extends BucketTotals {
  day: string;
}

export interface ModelPerDay {
  model: string;
  /** Exactly 7 entries, newest day first, same calendar-day buckets
   *  as MeterSummary.last7Days so the UI can sum the first N to get
   *  "last N days" totals without an extra fetch. */
  perDay: DayBucket[];
}

export interface MeterSummary {
  generatedAt: number;
  today: DayBucket;
  /** Newest day first. */
  last7Days: DayBucket[];
  /** Per-model breakdown over the same 7-day window. UI sums the first
   *  N entries when the user picks a shorter range. */
  byModelLast7: ModelPerDay[];
  lifetime: BucketTotals;
}

export interface HeatmapModelShare {
  model: string;
  tokens: number;
}

/**
 * Heatmap cell. Extends the generic `HeatmapCellBase` from the shared
 * viz layer — `value` carries the day's total token count so the
 * shared Heatmap component (which is value-agnostic) can render it.
 * The popover's per-model detail rows come from `modelBreakdown`.
 */
export interface TokenHeatmapCell extends HeatmapCellBase {
  /** Per-model contribution to this day, sorted by tokens desc. */
  modelBreakdown: HeatmapModelShare[];
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyTotals() {
  return {
    turns: 0,
    sessions: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

interface SessionRow {
  sessionId: string;
  model: string;
  lastActiveTs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turnCount: number;
  turn?: number;
  step?: number;
}

function normalizeDsh(record: AmibaUsageRecord): SessionRow {
  const prompt =
    record.uncachedInputTokens +
    record.cacheReadTokens +
    record.cacheWriteTokens;
  const model = [record.provider, record.model].filter(Boolean).join("/");
  return {
    sessionId: record.sessionId,
    model,
    lastActiveTs: record.ts,
    promptTokens: prompt,
    completionTokens: record.outputTokens,
    totalTokens: prompt + record.outputTokens,
    turnCount: 1,
    turn: record.turn,
    step: record.step,
  };
}

function addSession<T extends ReturnType<typeof emptyTotals>>(
  t: T,
  row: SessionRow,
  sessions: Set<string>,
): T {
  const isNewSession = !sessions.has(row.sessionId);
  sessions.add(row.sessionId);
  return {
    ...t,
    turns: t.turns + row.turnCount,
    sessions: t.sessions + (isNewSession ? 1 : 0),
    promptTokens: t.promptTokens + row.promptTokens,
    completionTokens: t.completionTokens + row.completionTokens,
    totalTokens: t.totalTokens + row.totalTokens,
  };
}

async function fetchRows(list: UsageListFn): Promise<SessionRow[]> {
  const result = await list();
  if (result.records.length === 0 && result.failures.length > 0) {
    throw new Error(result.failures[0]!.message);
  }
  return result.records
    .map(normalizeDsh)
    .sort((a, b) => b.lastActiveTs - a.lastActiveTs);
}

// ---------------------------------------------------------------------------
// Public fetchers (mirror the extension's meter.* IPC handlers)
// ---------------------------------------------------------------------------

export async function fetchTokenSummary(list: UsageListFn): Promise<MeterSummary> {
  const rows = await fetchRows(list);
  const todayKey = dayKey(new Date());

  let today: DayBucket = { day: todayKey, ...emptyTotals() };
  let lifetime = emptyTotals();
  const lifetimeSessions = new Set<string>();
  const todaySessions = new Set<string>();
  const last7Map = new Map<string, DayBucket>();
  const last7Sessions = new Map<string, Set<string>>();
  // model -> dayKey -> DayBucket. We bucket per-day per-model so the
  // UI can sum any window length (today / 3d / 7d) client-side
  // without re-aggregating.
  const byModelDay = new Map<string, Map<string, DayBucket>>();
  const modelSessionSets = new Map<string, Set<string>>();

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    last7Map.set(k, { day: k, ...emptyTotals() });
    last7Sessions.set(k, new Set());
  }

  for (const row of rows) {
    lifetime = { ...addSession(lifetime, row, lifetimeSessions) };

    const k = dayKey(new Date(row.lastActiveTs));
    const inWindow = last7Map.has(k);

    if (k === todayKey) {
      today = { ...addSession(today, row, todaySessions), day: todayKey };
    }

    if (inWindow) {
      const dayBucket = last7Map.get(k)!;
      last7Map.set(k, { ...addSession(dayBucket, row, last7Sessions.get(k)!), day: k });

      const modelKey = row.model || "(unknown)";
      let modelDays = byModelDay.get(modelKey);
      if (!modelDays) {
        modelDays = new Map();
        // Pre-seed all 7 days so the UI sees a stable shape.
        for (const dk of last7Map.keys()) {
          modelDays.set(dk, { day: dk, ...emptyTotals() });
        }
        byModelDay.set(modelKey, modelDays);
      }
      const cur = modelDays.get(k) ?? { day: k, ...emptyTotals() };
      const modelSessionKey = `${modelKey}\0${k}`;
      const seen = modelSessionSets.get(modelSessionKey) ?? new Set<string>();
      modelSessionSets.set(modelSessionKey, seen);
      modelDays.set(k, { ...addSession(cur, row, seen), day: k });
    }
  }

  // Newest day first for both shapes.
  const dayOrder: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayOrder.push(dayKey(d));
  }
  const last7Days: DayBucket[] = dayOrder.map(
    (k) => last7Map.get(k) ?? { day: k, ...emptyTotals() },
  );

  const byModelLast7: ModelPerDay[] = [...byModelDay.entries()]
    .map(([model, days]) => ({
      model,
      perDay: dayOrder.map(
        (k) => days.get(k) ?? { day: k, ...emptyTotals() },
      ),
    }))
    // Initial order is window-total tokens desc. UI re-sorts if it
    // narrows the range further (a model that's #1 over 7d may not
    // be #1 today).
    .sort((a, b) => {
      const ta = a.perDay.reduce((s, d) => s + d.totalTokens, 0);
      const tb = b.perDay.reduce((s, d) => s + d.totalTokens, 0);
      return tb - ta;
    });

  return {
    generatedAt: Date.now(),
    today,
    last7Days,
    byModelLast7,
    lifetime,
  };
}

export async function fetchTokenRecent(
  list: UsageListFn,
  limit: number,
): Promise<TurnUsage[]> {
  const capped = Math.max(1, Math.min(limit ?? 20, 200));
  const rows = await fetchRows(list);
  return rows.slice(0, capped).map<TurnUsage>((r) => ({
    ts: r.lastActiveTs,
    sessionId: r.sessionId,
    model: r.model,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    turn: r.turn,
    step: r.step,
  }));
}

export async function fetchTokenHeatmap(
  list: UsageListFn,
  weeks: number,
): Promise<TokenHeatmapCell[]> {
  const cappedWeeks = Math.max(1, Math.min(weeks ?? 12, 52));
  const days = cappedWeeks * 7;
  const rows = await fetchRows(list);

  // Per-day total tokens + per-day per-model contribution.
  interface DayAgg {
    tokens: number;
    byModel: Map<string, number>;
  }
  const perDay = new Map<string, DayAgg>();
  for (const r of rows) {
    const k = dayKey(new Date(r.lastActiveTs));
    const cur = perDay.get(k) ?? { tokens: 0, byModel: new Map() };
    cur.tokens += r.totalTokens;
    const modelKey = r.model || "(unknown)";
    cur.byModel.set(modelKey, (cur.byModel.get(modelKey) ?? 0) + r.totalTokens);
    perDay.set(k, cur);
  }

  // Build the window (oldest first). `value` is the shared Heatmap's
  // generic numeric — here that's total tokens of the day; the popover
  // labels it accordingly via formatValue.
  const cells: Array<Omit<TokenHeatmapCell, "level">> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    const agg = perDay.get(k);
    const tokens = agg?.tokens ?? 0;
    const breakdown: HeatmapModelShare[] = agg
      ? [...agg.byModel.entries()]
          .map(([model, t]) => ({ model, tokens: t }))
          .sort((a, b) => b.tokens - a.tokens)
      : [];
    cells.push({ day: k, value: tokens, modelBreakdown: breakdown });
  }

  // Quartile bucket against non-zero days.
  const nonZero = cells.map((c) => c.value).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (frac: number) =>
    nonZero.length === 0
      ? 0
      : nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * frac))]!;
  const q1 = q(0.25);
  const q2 = q(0.5);
  const q3 = q(0.75);

  return cells.map((c): TokenHeatmapCell => {
    let level: TokenHeatmapCell["level"] = 0;
    if (c.value > 0) {
      if (c.value > q3) level = 4;
      else if (c.value > q2) level = 3;
      else if (c.value > q1) level = 2;
      else level = 1;
    }
    return { ...c, level };
  });
}
