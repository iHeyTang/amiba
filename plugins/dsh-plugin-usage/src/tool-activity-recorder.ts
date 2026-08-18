/**
 * Tool-activity recorder — captures the runtime's `tool/call` /
 * `tool/result` session events into per-day JSON buckets on disk and
 * serves them back to the plugin's client over the Typert Remote.
 *
 * Faithful port of the desktop main-process recorder
 * (`apps/desktop/src/main/tool-activity.ts` + the tool half of its
 * `dsh-telemetry.ts` projector) into the plugin runtime: instead of
 * mirroring the mux event firehose over the desktop API, the plugin
 * subscribes in-process to the post-commit `session/event` feed (see
 * `index.ts`), so capture runs for every session this runtime executes —
 * with or without a desktop window attached.
 *
 * Layout under the configured root:
 *   YYYY-MM-DD.json → ToolInvocation[]   (local-tz day buckets)
 *   lifetime.json   → ToolActivityTotals (running aggregate)
 *
 * All writes funnel through a single promise chain — tool events can
 * land back-to-back and a read-modify-write race would drop rows.
 */

import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SessionEvent } from "@deepseek-ai/dsh-session";

import {
  emptyToolActivityTotals,
  toolActivityDayKey,
  type ToolActivityReadResult,
  type ToolActivityTotals,
  type ToolInvocation,
} from "./tool-activity.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many days back a completion searches for the started row. */
const COMPLETE_LOOKBACK_DAYS = 7;
/** Hard cap on the remote read window (52 weeks of heatmap). */
const MAX_READ_DAYS = 366;

export class ToolActivityRecorder {
  private queue: Promise<void> = Promise.resolve();

  /**
   * `${sessionId}:${callId}` → start time, for duration attribution.
   * Entries for calls whose result never arrives stay until process end
   * — same bounded-in-practice trade-off the desktop projector made.
   */
  private readonly pendingStarts = new Map<string, number>();

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  /** DSH `session/event` sink — record tool starts and completions. */
  accept(sessionId: string, event: SessionEvent): void {
    if (event.type === "tool/call") {
      const { callId, name, turn } = event.data;
      if (!callId || !Number.isInteger(turn)) return;
      this.pendingStarts.set(`${sessionId}:${callId}`, event.time);
      this.appendInvocation({
        ts: event.time,
        sessionId,
        runId: `${sessionId}:${turn}`,
        tool: name || "tool",
        toolCallId: callId,
        completed: false,
      });
    } else if (event.type === "tool/result") {
      const message = event.data.message;
      const callId =
        message?.source?.callId ?? message?.content?.[0]?.toolCallId ?? "";
      if (!callId) return;
      const key = `${sessionId}:${callId}`;
      const startedAt = this.pendingStarts.get(key);
      this.pendingStarts.delete(key);
      const durationMs =
        startedAt !== undefined && event.time >= startedAt
          ? event.time - startedAt
          : undefined;
      this.markCompleted(sessionId, callId, durationMs);
    }
  }

  /**
   * Read back the most recent `days` day buckets (newest first) plus the
   * lifetime aggregate. Flushes pending writes first so a read right
   * after a tool event sees it.
   */
  async read(days: number): Promise<ToolActivityReadResult> {
    const capped = Math.max(1, Math.min(days, MAX_READ_DAYS));
    await this.queue;
    const out: ToolActivityReadResult = {
      days: [],
      lifetime: await this.readLifetime(),
    };
    for (let i = 0; i < capped; i++) {
      const day = toolActivityDayKey(Date.now() - i * DAY_MS);
      out.days.push({ day, rows: await this.readDay(day) });
    }
    return out;
  }

  // -------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------

  private dayPath(day: string): string {
    return join(this.root, `${day}.json`);
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async readDay(day: string): Promise<ToolInvocation[]> {
    const v = await this.readJson<ToolInvocation[]>(this.dayPath(day), []);
    return Array.isArray(v) ? v : [];
  }

  private async readLifetime(): Promise<ToolActivityTotals> {
    return this.readJson<ToolActivityTotals>(
      join(this.root, "lifetime.json"),
      emptyToolActivityTotals(),
    );
  }

  private async writeLifetime(totals: ToolActivityTotals): Promise<void> {
    await writeFile(join(this.root, "lifetime.json"), JSON.stringify(totals));
  }

  /** Serialize mutations; a failed step logs and never poisons the chain. */
  private enqueue(step: () => Promise<void>): void {
    this.queue = this.queue.then(step).catch((err) => {
      console.warn("[amiba-usage] tool-activity write failed:", err);
    });
  }

  private appendInvocation(inv: ToolInvocation): void {
    this.enqueue(async () => {
      const day = toolActivityDayKey(inv.ts);
      const rows = await this.readDay(day);
      rows.push(inv);
      await writeFile(this.dayPath(day), JSON.stringify(rows));
      const life = await this.readLifetime();
      await this.writeLifetime({
        ...life,
        calls: life.calls + 1,
        unfinished: life.unfinished + 1,
      });
    });
  }

  private markCompleted(
    sessionId: string,
    toolCallId: string,
    durationMs: number | undefined,
  ): void {
    this.enqueue(async () => {
      // Walk recent days — a tool can technically span midnight, but 99%
      // of the time the started row is in today's bucket. Match on the
      // session too: engines may hand out sequential call ids, so a bare
      // callId can collide across concurrent sessions.
      for (let i = 0; i < COMPLETE_LOOKBACK_DAYS; i++) {
        const day = toolActivityDayKey(Date.now() - i * DAY_MS);
        const rows = await this.readDay(day);
        const idx = rows.findIndex(
          (r) => r.toolCallId === toolCallId && r.sessionId === sessionId,
        );
        if (idx < 0) continue;
        const row = rows[idx]!;
        if (row.completed) return;
        rows[idx] = { ...row, durationMs, completed: true };
        await writeFile(this.dayPath(day), JSON.stringify(rows));
        const life = await this.readLifetime();
        await this.writeLifetime({
          ...life,
          totalDurationMs: life.totalDurationMs + (durationMs ?? 0),
          unfinished: Math.max(0, life.unfinished - 1),
        });
        return;
      }
    });
  }
}
