import type { NotificationRemote } from "../remote.js";
import {
  updateSchema,
  type AmibaNotification,
  type NotificationCursor,
  type SessionRead,
} from "../model.js";
export function createNotificationClient(remote: NotificationRemote) {
  const subscriber = crypto.randomUUID();
  let cursor: NotificationCursor | null = null;
  let rows: AmibaNotification[] = [];
  let disposed = false,
    generation = 0,
    retry = 250;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let readRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let readRetry = 250;
  const listeners = new Set<() => void>();
  let connection: "loading" | "connected" | "reconnecting" = "loading";
  const setConnection = (next: typeof connection) => {
    if (connection === next) return;
    connection = next;
    listeners.forEach(fn => { try { fn(); } catch (error) { console.warn("Notification subscriber failed", error); } });
  };
  const desiredReads = new Map<string, number>(),
    sentReads = new Map<string, number>();
  let reading = false;
  const value = async <T>(
    p: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
  ): Promise<T> => {
    const r = await p;
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };
  const flushReads = async () => {
    if (reading || disposed) return;
    reading = true;
    const token = generation;
    try {
      while (!disposed) {
        const batch = [...desiredReads]
          .filter(([id, at]) => at > (sentReads.get(id) ?? -1))
          .slice(0, 1000)
          .map(([sessionId, readAt]) => ({ sessionId, readAt }));
        if (!batch.length) break;
        await value(remote.markSessionsRead(batch));
        if (disposed || token !== generation) return;
        readRetry = 250;
        batch.forEach(({ sessionId, readAt }) =>
          sentReads.set(sessionId, readAt),
        );
      }
    } catch {
      if (!disposed) {
        clearTimeout(readRetryTimer);
        readRetryTimer = setTimeout(() => {
          readRetryTimer = undefined;
          void flushReads();
        }, readRetry);
        readRetry = Math.min(readRetry * 2, 10000);
      }
    } finally {
      reading = false;
      if (!disposed && token !== generation) void flushReads();
    }
  };
  const run = async (token: number) => {
    while (!disposed && token === generation) {
      try {
        const update = updateSchema.parse(
          await value(remote.watch(cursor, subscriber)),
        );
        if (disposed || token !== generation) return;
        const changed =
          update.reset ||
          update.cursor.revision !== cursor?.revision ||
          update.cursor.epoch !== cursor?.epoch;
        if (changed) {
          const byId = new Map(
            (update.reset ? [] : rows).map((n) => [n.id, n]),
          );
          update.removed.forEach((id) => byId.delete(id));
          update.notifications.forEach((n) => byId.set(n.id, n));
          rows = [...byId.values()].sort(
            (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
          );
          cursor = update.cursor;
          listeners.forEach((fn) => {
            try {
              fn();
            } catch (error) {
              console.warn("Notification subscriber failed", error);
            }
          });
        }
        setConnection("connected");
        retry = 250;
        await flushReads();
      } catch {
        if (disposed || token !== generation) return;
        setConnection("reconnecting");
        const delay = retry;
        retry = Math.min(retry * 2, 10000);
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          void run(token);
        }, delay);
        return;
      }
    }
  };
  const resync = () => {
    if (disposed) return;
    setConnection("reconnecting");
    const token = ++generation;
    cursor = null;
    sentReads.clear();
    clearTimeout(retryTimer);
    clearTimeout(readRetryTimer);
    void value(remote.cancelWatch(subscriber))
      .catch(() => {})
      .finally(() => {
        if (!disposed && token === generation) void run(token);
      });
  };
  void run(generation);
  return {
    getSnapshot: () => rows,
    getConnectionSnapshot: () => connection,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dismiss: async (id: string) => {
      await value(remote.dismiss(id));
    },
    markSessionsRead: (reads: readonly SessionRead[]) => {
      for (const { sessionId, readAt } of reads)
        if (readAt > (desiredReads.get(sessionId) ?? -1))
          desiredReads.set(sessionId, readAt);
      void flushReads().catch(() => {});
    },
    resync,
    dispose: () => {
      disposed = true;
      generation++;
      clearTimeout(retryTimer);
      clearTimeout(readRetryTimer);
      listeners.clear();
      void value(remote.cancelWatch(subscriber)).catch(() => {});
    },
  };
}
export type NotificationClient = ReturnType<typeof createNotificationClient>;
