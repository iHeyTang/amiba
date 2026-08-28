import type { CronRule, CronTask } from "./types.js";

const MIN_EVERY_SECONDS = 300;
const DAILY_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/u;

/** Validate a rule at the management boundary; throws with a stable message. */
export function assertValidRule(rule: CronRule): void {
  if (rule.kind === "at") {
    const instant = Date.parse(rule.at);
    if (!Number.isFinite(instant)) {
      throw new Error("cron: `at` must be an RFC 3339 instant");
    }
    return;
  }
  if (rule.kind === "daily") {
    if (!DAILY_TIME.test(rule.time)) {
      throw new Error("cron: `time` must be HH:mm (24h)");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: rule.timeZone });
    } catch {
      throw new Error(`cron: unknown time zone "${rule.timeZone}"`);
    }
    return;
  }
  if (
    !Number.isSafeInteger(rule.everySeconds) ||
    rule.everySeconds < MIN_EVERY_SECONDS
  ) {
    throw new Error(
      `cron: \`everySeconds\` must be an integer of at least ${MIN_EVERY_SECONDS}`,
    );
  }
}

/** Read a UTC instant's wall-clock fields in a zone. */
function zonedParts(
  instant: number,
  timeZone: string,
): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const field = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    y: field("year"),
    mo: field("month"),
    d: field("day"),
    h: field("hour"),
    mi: field("minute"),
  };
}

/**
 * The UTC instant at which a zone's wall clock reads the given fields.
 *
 * Probe-and-correct rather than a time-zone table: guess the instant as if
 * the zone were UTC, read the guess back through the zone, and correct by the
 * observed difference (twice, for the rare case where the first correction
 * crosses a DST transition). A time inside a spring-forward gap lands on the
 * closest real instant instead of throwing — a daily task at 02:30 still runs
 * on the gap day.
 */
function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): number {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i += 1) {
    const seen = zonedParts(guess, timeZone);
    const want = Date.UTC(y, mo - 1, d, h, mi);
    const got = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi);
    if (got === want) return guess;
    guess += want - got;
  }
  return guess;
}

/**
 * The task's next fire strictly after `after`, or null when none exists.
 * Deterministic in (task, after) — the timer loop and the UI both call this.
 */
export function nextRunAt(task: CronTask, after: number): number | null {
  if (!task.enabled) return null;
  const rule = task.rule;
  if (rule.kind === "at") {
    const instant = Date.parse(rule.at);
    if (!Number.isFinite(instant)) return null;
    // A one-shot that already ran is exhausted even if `after` predates it.
    if (task.lastRunAt !== undefined && task.lastRunAt >= instant) return null;
    return instant > after ? instant : instant;
  }
  if (rule.kind === "every") {
    const stepMs = rule.everySeconds * 1000;
    const anchor = task.createdAt;
    const base = Math.max(after, task.lastRunAt ?? anchor);
    const steps = Math.floor((base - anchor) / stepMs) + 1;
    return anchor + Math.max(1, steps) * stepMs;
  }
  const [h, mi] = rule.time.split(":").map(Number) as [number, number];
  // Walk day by day from `after`'s date in the zone until the target is
  // strictly in the future; two iterations suffice outside DST edges, three
  // covers them.
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const parts = zonedParts(after + dayOffset * 86_400_000, rule.timeZone);
    const target = zonedTimeToUtc(parts.y, parts.mo, parts.d, h, mi, rule.timeZone);
    if (target > after) return target;
  }
  return null;
}

/**
 * Whether a fire was missed between `lastSeen` and `now` — the catch-up
 * question asked once at startup. A task that has never run measures from its
 * creation.
 */
export function missedRunAt(task: CronTask, now: number): number | null {
  if (!task.enabled || !task.catchUp) return null;
  const from = task.lastRunAt ?? task.createdAt;
  const due = nextRunAt({ ...task, lastRunAt: undefined }, from);
  return due !== null && due <= now && (task.lastRunAt ?? 0) < due ? due : null;
}
