import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import {
  notificationInputSchema,
  notificationSchema,
  isNotificationProtected,
  type AmibaNotification,
  type AmibaNotificationInput,
  type NotificationCursor,
  type NotificationUpdate,
  type SessionRead,
} from "./model.js";
export * from "./model.js";
export type AmibaNotificationSink = (notification: AmibaNotification) => void;
const HISTORY_LIMIT = 100;
const CHANGE_LIMIT = 256;
export class AmibaNotificationHub {
  private rows: AmibaNotification[] = [];
  private reads: Record<string, number> = Object.create(null);
  private readonly epoch = randomUUID();
  private revision = 0;
  private changes: NotificationUpdate[] = [];
  private listeners = new Set<() => void>();
  private sinks = new Set<AmibaNotificationSink>();
  private waits = new Map<string, () => void>();
  private disposed = false;
  constructor(
    private readonly ctx: Context,
    private readonly root?: string,
  ) {
    if (!root) return;
    mkdirSync(root, { recursive: true });
    try {
      const saved = JSON.parse(
        readFileSync(join(root, "notifications.json"), "utf8"),
      );
      const entries = Array.isArray(saved) ? saved : saved.notifications;
      if (!Array.isArray(entries))
        throw new Error("Invalid notification store");
      this.rows = entries.map((entry) => {
        // Preserve notices created by the previous acknowledgement-only format.
        const { acknowledgedAt, ...row } = entry;
        return notificationSchema.parse({
          ...row,
          ...(acknowledgedAt !== undefined && row.dismissedAt === undefined
            ? { dismissedAt: acknowledgedAt }
            : {}),
        });
      });
      if (
        !Array.isArray(saved) &&
        saved.reads &&
        typeof saved.reads === "object"
      ) {
        for (const [id, at] of Object.entries(saved.reads))
          if (typeof at === "number" && Number.isFinite(at))
            this.reads[id] = at;
      }
      this.rows = this.prune(this.rows.filter(n => !n.activity));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private prune(rows: AmibaNotification[]) {
    const history = rows.filter((n) => !isNotificationProtected(n));
    const retained = new Set(history.slice(-HISTORY_LIMIT).map((n) => n.id));
    return rows.filter((n) => isNotificationProtected(n) || retained.has(n.id));
  }
  private commit(next: AmibaNotification[], reads = this.reads) {
    if (this.disposed) throw new Error("Notification center disposed");
    next = this.prune(next);
    const previous = new Map(this.rows.map((n) => [n.id, n]));
    const ids = new Set(next.map((n) => n.id));
    const changed = next.filter((n) => n !== previous.get(n.id));
    const removed = this.rows.filter((n) => !ids.has(n.id)).map((n) => n.id);
    if (changed.length === 0 && removed.length === 0 && reads === this.reads)
      return;
    if (this.root) {
      const file = join(this.root, "notifications.json");
      writeFileSync(
        file + ".tmp",
        JSON.stringify({ version: 2, notifications: next.filter(n => !n.activity), reads }),
      );
      renameSync(file + ".tmp", file);
    }
    this.rows = next;
    this.reads = reads;
    if (!changed.length && !removed.length) return;
    this.revision++;
    this.changes.push({
      cursor: this.cursor(),
      reset: false,
      notifications: changed,
      removed,
    });
    if (this.changes.length > CHANGE_LIMIT) this.changes.shift();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.ctx.logger.warn(
          `Notification subscriber failed: ${String(error)}`,
        );
      }
    }
  }
  private cursor(): NotificationCursor {
    return { epoch: this.epoch, revision: this.revision };
  }
  post(input: AmibaNotificationInput): { id: string } {
    const parsed = notificationInputSchema.parse(input);
    const existing =
      parsed.key &&
      this.rows.find((n) => n.source === parsed.source && n.key === parsed.key);
    if (existing) return { id: existing.id };
    const timestamp = Date.now();
    const readAt = parsed.sessionId && this.reads[parsed.sessionId];
    const row: AmibaNotification = {
      ...parsed,
      id: `ntf_${randomUUID()}`,
      timestamp,
      ...(typeof readAt === "number" && readAt >= timestamp ? { readAt } : {}),
    };
    this.commit([...this.rows, row]);
    for (const sink of [...this.sinks]) {
      try {
        sink({ ...row });
      } catch (error) {
        this.ctx.logger.warn(`Notification sink failed: ${String(error)}`);
      }
    }
    return { id: row.id };
  }
  /** Volatile execution projection: broadcast on the feed, never persist or send OS alerts. */
  setSessionActivity(sessionId: string, title: string, status: "thinking" | "responding" | "tooling" | "waiting" | null) {
    const id = `activity:${sessionId}`;
    const previous = this.rows.find(n => n.id === id);
    if (!status) {
      if (previous) this.commit(this.rows.filter(n => n.id !== id));
      return;
    }
    const clean = title.trim().slice(0, 160) || "Untitled conversation";
    if (previous?.status === status && previous.title === clean) return;
    const row: AmibaNotification = { id, activity: true, sessionId, title: clean,
      source: "conversation", kind: "info", status, timestamp: Date.now() };
    this.commit([...this.rows.filter(n => n.id !== id), row]);
  }
  dismiss(id: string) {
    this.commit(
      this.rows.map((n) =>
        !n.activity && n.id === id && n.dismissedAt === undefined
          ? { ...n, dismissedAt: Date.now() }
          : n,
      ),
    );
  }
  markSessionsRead(entries: readonly SessionRead[]) {
    const reads = { ...this.reads };
    let changed = false;
    for (const { sessionId, readAt } of entries) {
      if (!Number.isFinite(readAt) || readAt < 0)
        throw new Error("Invalid read timestamp");
      const through = Math.min(readAt, Date.now());
      if (through > (reads[sessionId] ?? -1)) {
        reads[sessionId] = through;
        changed = true;
      }
    }
    if (!changed) return;
    this.commit(
      this.rows.map((n) =>
        !n.activity && n.sessionId &&
        (reads[n.sessionId] ?? -1) >= n.timestamp &&
        n.readAt === undefined
          ? { ...n, readAt: reads[n.sessionId] }
          : n,
      ),
      reads,
    );
  }
  resolve(source: string, key: string) {
    this.resolveWhere((n) => n.source === source && n.key === key);
  }
  resolveNotification(id: string) {
    this.resolveWhere((n) => n.id === id);
  }
  private resolveWhere(matches: (n: AmibaNotification) => boolean) {
    this.commit(
      this.rows.map((n) =>
        matches(n) && n.resolvedAt === undefined
          ? { ...n, resolvedAt: Date.now() }
          : n,
      ),
    );
  }
  renameSession(sessionId: string, title: string) {
    const clean = title.trim().slice(0, 160);
    if (!clean) return;
    this.commit(
      this.rows.map((n) =>
        n.sessionId === sessionId && n.status && n.title !== clean
          ? { ...n, title: clean }
          : n,
      ),
    );
  }
  list(): AmibaNotification[] {
    return this.rows.map((n) => ({ ...n }));
  }
  updates(after: NotificationCursor | null): NotificationUpdate {
    if (
      !after ||
      after.epoch !== this.epoch ||
      after.revision > this.revision ||
      after.revision <
        (this.changes[0]?.cursor.revision ?? this.revision + 1) - 1
    )
      return {
        cursor: this.cursor(),
        reset: true,
        notifications: this.list(),
        removed: [],
      };
    const changed = new Map<string, AmibaNotification>();
    const removed = new Set<string>();
    for (const update of this.changes)
      if (update.cursor.revision > after.revision) {
        for (const n of update.notifications) {
          changed.set(n.id, n);
          removed.delete(n.id);
        }
        for (const id of update.removed) {
          changed.delete(id);
          removed.add(id);
        }
      }
    return {
      cursor: this.cursor(),
      reset: false,
      notifications: [...changed.values()].map((n) => ({ ...n })),
      removed: [...removed],
    };
  }
  /** Event-driven long-poll subscription using the existing authenticated RPC carrier. */
  watch(
    after: NotificationCursor | null,
    subscriber: string,
  ): Promise<NotificationUpdate> {
    if (this.disposed)
      return Promise.reject(new Error("Notification center disposed"));
    this.cancelWatch(subscriber);
    const update = this.updates(after);
    if (update.reset || update.cursor.revision !== after?.revision)
      return Promise.resolve(update);
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.listeners.delete(finish);
        this.waits.delete(subscriber);
        resolve(this.updates(after));
      };
      const timer = setTimeout(finish, 20_000);
      this.listeners.add(finish);
      this.waits.set(subscriber, finish);
    });
  }
  cancelWatch(subscriber: string) {
    this.waits.get(subscriber)?.();
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  registerSink(sink: AmibaNotificationSink) {
    if (this.sinks.has(sink))
      throw new Error("duplicate notification sink registration");
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }
  dispose() {
    this.disposed = true;
    for (const finish of [...this.waits.values()]) finish();
    this.listeners.clear();
    this.sinks.clear();
  }
}
