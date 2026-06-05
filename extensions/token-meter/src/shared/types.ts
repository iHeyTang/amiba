/**
 * Wire types shared between the main runner and the UI panel.
 *
 * Cost / USD is intentionally absent: hermes-agent's own cost numbers
 * depend on per-account plan terms (subscription-included, prepaid
 * credits, per-token rate cards) that this panel can't reason about
 * honestly. We surface tokens — the one number we can measure exactly
 * — and let the user reason about cost wherever billing actually
 * lives.
 */

export interface TurnUsage {
  ts: number
  sessionId?: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface BucketTotals {
  turns: number
  sessions: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface DayBucket extends BucketTotals {
  day: string
}

export interface ModelTotals extends BucketTotals {
  model: string
}

export interface ModelPerDay {
  model: string
  /** Exactly 7 entries, newest day first, same calendar-day buckets
   *  as MeterSummary.last7Days so the UI can sum the first N to get
   *  "last N days" totals without an extra IPC. */
  perDay: DayBucket[]
}

export interface MeterSummary {
  generatedAt: number
  today: DayBucket
  /** Newest day first. */
  last7Days: DayBucket[]
  /** Per-model breakdown over the same 7-day window. UI sums the first
   *  N entries when the user picks a shorter range. */
  byModelLast7: ModelPerDay[]
  lifetime: BucketTotals
}

export interface HeatmapModelShare {
  model: string
  tokens: number
}

/**
 * Heatmap cell. Extends the generic `HeatmapCellBase` from
 * @hermes-x/ui — `value` carries the day's total token count so the
 * shared Heatmap component (which is value-agnostic) can render it.
 * The popover's per-model detail rows come from `modelBreakdown`.
 */
export interface HeatmapCell {
  day: string
  /** Total tokens for the day; 0 means no activity. */
  value: number
  level: 0 | 1 | 2 | 3 | 4
  /** Per-model contribution to this day, sorted by tokens desc. */
  modelBreakdown: HeatmapModelShare[]
}
