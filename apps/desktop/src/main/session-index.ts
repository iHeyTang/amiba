/**
 * Shared DSH session index poller.
 *
 * ONE poll of `session/list` every 2s serves every main-process consumer
 * that needs session-level facts — the dsh-state layer's cross-window
 * revision broadcast, the activity tracker's session selection, and the
 * hosted chat engine's hostRunning + subagent-parent resolution. Previously
 * each of those ran its own poll of the same endpoint; this is the single
 * source so the cadence, backoff and lifecycle are defined once.
 */

import type { DshApiClient } from "@amiba/app-runtime/dsh-client";
import { dshRuntime } from "./dsh-runtime";
import type { DshSessionRow } from "./dsh-state/types";

export function dshRuntimeClient(): Promise<DshApiClient> {
  return dshRuntime.ensureStarted().then((handle) => handle.client);
}

export class SessionIndex {
  private rows: DshSessionRow[] = [];
  private byId = new Map<string, DshSessionRow>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private disposed = false;
  private started = false;
  private readonly listeners = new Set<(rows: DshSessionRow[]) => void>();

  constructor(private readonly client: () => Promise<DshApiClient> = dshRuntimeClient) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 2_000);
    this.timer.unref?.();
  }

  /** Subscribe to every poll result; fires immediately if an index exists. */
  onChange(listener: (rows: DshSessionRow[]) => void): () => void {
    this.listeners.add(listener);
    if (this.rows.length !== 0) listener(this.rows);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): DshSessionRow[] {
    return this.rows;
  }

  running(sessionId: string): boolean {
    return this.byId.get(sessionId)?.running ?? false;
  }

  parent(sessionId: string): string | undefined {
    return this.byId.get(sessionId)?.parentSessionId;
  }

  dispose(): void {
    this.disposed = true;
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  private async poll(): Promise<void> {
    if (this.disposed || this.pending) return;
    this.pending = this.run().finally(() => {
      this.pending = undefined;
    });
  }

  private async run(): Promise<void> {
    try {
      const client = await this.client();
      const { items } = await client.listSessions();
      const rows: DshSessionRow[] = items.map((item) => ({
        sessionId: item.sessionId,
        updatedAt: item.updatedAt,
        running: item.running,
        blank: item.blank,
        ...(item.parentSessionId === undefined
          ? {}
          : { parentSessionId: item.parentSessionId }),
        ...(item.agentPreset === undefined
          ? {}
          : { agentPreset: item.agentPreset }),
        ...(typeof item.projections?.values?.title === "string"
          ? { title: item.projections.values.title as string }
          : {}),
      }));
      this.rows = rows;
      this.byId = new Map(rows.map((row) => [row.sessionId, row]));
      for (const listener of this.listeners) listener(rows);
    } catch {
      // Runtime not ready / transient — keep the last index; next tick retries.
    }
  }
}

export const sessionIndex = new SessionIndex();