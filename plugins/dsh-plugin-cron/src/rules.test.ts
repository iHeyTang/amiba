import { describe, expect, it } from "vitest";

import { assertValidRule, missedRunAt, nextRunAt } from "./rules.js";
import type { CronTask } from "./types.js";

const T0 = Date.UTC(2026, 0, 10, 12, 0, 0); // 2026-01-10T12:00:00Z

function task(overrides: Partial<CronTask>): CronTask {
  return {
    id: "cron_x",
    name: "x",
    prompt: "run",
    rule: { kind: "every", everySeconds: 3600 },
    enabled: true,
    catchUp: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe("cron rules", () => {
  it("computes a one-shot's fire and exhausts it after running", () => {
    const at = new Date(T0 + 3_600_000).toISOString();
    const oneShot = task({ rule: { kind: "at", at } });
    expect(nextRunAt(oneShot, T0)).toBe(T0 + 3_600_000);
    expect(nextRunAt({ ...oneShot, lastRunAt: T0 + 3_600_000 }, T0)).toBeNull();
  });

  it("anchors fixed intervals at creation, stepping past the last run", () => {
    const every = task({ rule: { kind: "every", everySeconds: 3600 } });
    expect(nextRunAt(every, T0)).toBe(T0 + 3_600_000);
    // Half an hour in, still the same target.
    expect(nextRunAt(every, T0 + 1_800_000)).toBe(T0 + 3_600_000);
    // After the first run, the next anchor-aligned step.
    expect(nextRunAt({ ...every, lastRunAt: T0 + 3_600_000 }, T0 + 3_600_000)).toBe(
      T0 + 7_200_000,
    );
  });

  it("resolves a daily rule in its own zone, today or tomorrow", () => {
    // 12:00Z on Jan 10 = 20:00 in Shanghai. A 21:00 task fires the same
    // Shanghai day; a 09:00 task fires the next one.
    const evening = task({
      rule: { kind: "daily", time: "21:00", timeZone: "Asia/Shanghai" },
    });
    const morning = task({
      rule: { kind: "daily", time: "09:00", timeZone: "Asia/Shanghai" },
    });
    expect(nextRunAt(evening, T0)).toBe(Date.UTC(2026, 0, 10, 13, 0)); // 21:00+08
    expect(nextRunAt(morning, T0)).toBe(Date.UTC(2026, 0, 11, 1, 0)); // 09:00+08 next day
  });

  it("a disabled task never fires", () => {
    expect(nextRunAt(task({ enabled: false }), T0)).toBeNull();
  });

  it("reports a missed fire only for enabled catch-up tasks", () => {
    const missedAt = T0 + 3_600_000;
    const late = T0 + 10 * 3_600_000;
    const plain = task({});
    const optedIn = task({ catchUp: true });
    expect(missedRunAt(plain, late)).toBeNull();
    expect(missedRunAt(optedIn, late)).toBe(missedAt);
    // Already ran after the due point → nothing missed.
    expect(missedRunAt({ ...optedIn, lastRunAt: late }, late)).toBeNull();
  });

  it("rejects malformed rules with stable messages", () => {
    expect(() => assertValidRule({ kind: "at", at: "not-a-date" })).toThrow(
      /RFC 3339/u,
    );
    expect(() =>
      assertValidRule({ kind: "daily", time: "25:00", timeZone: "UTC" }),
    ).toThrow(/HH:mm/u);
    expect(() =>
      assertValidRule({ kind: "daily", time: "09:00", timeZone: "Not/AZone" }),
    ).toThrow(/unknown time zone/u);
    expect(() => assertValidRule({ kind: "every", everySeconds: 60 })).toThrow(
      /at least 300/u,
    );
  });
});
