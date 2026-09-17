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
/** Debounce window for co-locating tool-event disk flushes. */
const FLUSH_DEBOUNCE_MS = 1500;

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
   * lifetime aggregate. Pending in-memory mutations are flushed to disk
   * first, so a read right after a tool event sees it AND the on-disk files
   * are up to date — the recorder's storage contract (freshness + durability
   * point at the read boundary).
   */
  async read(days: number): Promise<ToolActivityReadResult> {
    const capped = Math.max(1, Math.min(days, MAX_READ_DAYS));
    await this.flushNow();
    const out: ToolActivityReadResult = {
      days: [],
      lifetime:
        this.memLifetime ?? (await this.readLifetimeFromDisk()),
    };
    for (let i = 0; i < capped; i++) {
      const day = toolActivityDayKey(Date.now() - i * DAY_MS);
      out.days.push({
        day,
        rows:
          this.memDays.get(day) ?? (await this.readDayFromDisk(day)),
      });
    }
    return out;
  }

  // -------------------------------------------------------------------
  // Storage — memory-authoritative with a debounced disk flush.
  //
  // Tool activity is high-frequency telemetry (one call + one result per
  // tool use). Previously every event did a read-modify-write of the whole
  // day file plus lifetime.json: a run with 200 tools serialized a growing
  // 200 KB+ array 400+ times, O(n²) write amplification and constant fsync
  // pressure. Days and the lifetime aggregate are now authoritative in
  // memory (lazily loaded from disk on first touch) and written once per
  // flush window. A crash loses at most the last FLUSH_DEBOUNCE_MS of
  // telemetry — acceptable for usage stats, and `read()` still flushes
  // before returning.
  // -------------------------------------------------------------------

  private readonly memDays = new Map<string, ToolInvocation[]>();
  private memLifetime: ToolActivityTotals | null = null;
  private readonly dirtyDays = new Set<string>();
  private dirtyLifetime = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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

  private async readDayFromDisk(day: string): Promise<ToolInvocation[]> {
    const v = await this.readJson<ToolInvocation[]>(
      this.dayPath(day),
      [],
    );
    return Array.isArray(v) ? v : [];
  }

  private async readLifetimeFromDisk(): Promise<ToolActivityTotals> {
    return this.readJson<ToolActivityTotals>(
      join(this.root, "lifetime.json"),
      emptyToolActivityTotals(),
    );
  }

  /** Load (or fetch from memory) the authoritative row list for a day. */
  private async ensureDay(day: string): Promise<ToolInvocation[]> {
    let rows = this.memDays.get(day);
    if (rows === undefined) {
      rows = await this.readDayFromDisk(day);
      this.memDays.set(day, rows);
    }
    return rows;
  }

  private async ensureLifetime(): Promise<ToolActivityTotals> {
    if (!this.memLifetime) {
      this.memLifetime = await this.readLifetimeFromDisk();
    }
    return this.memLifetime;
  }

  /** Serialize mutations; a failed step logs and never poisons the chain. */
  private enqueue(step: () => Promise<void>): void {
    this.queue = this.queue.then(step).catch((err) => {
      console.warn("[amiba-usage] tool-activity write failed:", err);
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.enqueue(() => this.flushDirty());
    }, FLUSH_DEBOUNCE_MS);
  }

  private async flushDirty(): Promise<void> {
    for (const day of this.dirtyDays) {
      const rows = this.memDays.get(day);
      if (rows) await writeFile(this.dayPath(day), JSON.stringify(rows));
    }
    this.dirtyDays.clear();
    if (this.dirtyLifetime && this.memLifetime) {
      await writeFile(
        join(this.root, "lifetime.json"),
        JSON.stringify(this.memLifetime),
      );
      this.dirtyLifetime = false;
    }
  }

  /** Flush dirty state now (and any queued mutations) to disk. */
  private flushNow(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Enqueue the flush unconditionally: the dirty flags are set *inside*
    // the queued mutation steps, so they may not be visible yet when a read
    // arrives right after accept(). `flushDirty` is a no-op when nothing is
    // dirty, so the extra queued step is free.
    this.enqueue(() => this.flushDirty());
    return this.queue;
  }

  private appendInvocation(inv: ToolInvocation): void {
    this.enqueue(async () => {
      const day = toolActivityDayKey(inv.ts);
      const rows = await this.ensureDay(day);
      rows.push(inv);
      const life = await this.ensureLifetime();
      life.calls += 1;
      life.unfinished += 1;
      this.dirtyDays.add(day);
      this.dirtyLifetime = true;
      this.scheduleFlush();
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
        const rows = await this.ensureDay(day);
        const idx = rows.findIndex(
          (r) => r.toolCallId === toolCallId && r.sessionId === sessionId,
        );
        if (idx < 0) continue;
        const row = rows[idx]!;
        if (row.completed) return;
        rows[idx] = { ...row, durationMs, completed: true };
        const life = await this.ensureLifetime();
        life.totalDurationMs += durationMs ?? 0;
        life.unfinished = Math.max(0, life.unfinished - 1);
        this.dirtyDays.add(day);
        this.dirtyLifetime = true;
        this.scheduleFlush();
        return;
      }
    });
  }
}
