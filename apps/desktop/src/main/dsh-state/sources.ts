/**
 * Main-process DSH data sources.
 *
 * Each source owns one subscription pattern against the DSH runtime through
 * the main process's single `DshApiClient` (the same client the runtime
 * controller hands out): the pet library is polled like the plugin client
 * does (`amibaPets/list`), the notification hub is long-polled
 * (`amibaNotifications/watch`, mirroring the plugin's official client loop),
 * and the session index is polled (`session/list`). Sources are
 * window-independent: they start with the app and keep running until the
 * layer is stopped, so a closed main window never interrupts the feed.
 */

import { randomUUID } from "node:crypto";
import type { DshApiClient } from "@amiba/app-runtime/dsh-client";
import type {
  DshNotificationRow,
  DshNotificationUpdate,
  DshPetLibrary,
} from "./types";

/** Poll `amibaPets/list` on the same cadence the plugin client uses. */
export class PetsSource {
  private library: DshPetLibrary | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private disposed = false;
  private readonly listeners = new Set<(library: DshPetLibrary) => void>();

  // Plain field + assignment instead of a constructor parameter property:
  // parameter properties need a transform, and the main-process test runner
  // imports these modules with `node --experimental-strip-types`.
  private readonly client: () => Promise<DshApiClient>;

  constructor(client: () => Promise<DshApiClient>) {
    this.client = client;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 2_000);
    this.timer.unref?.();
  }

  private emit(library: DshPetLibrary): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(library);
  }

  onChange(listener: (library: DshPetLibrary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): DshPetLibrary | null {
    return this.library;
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
      // `DshApiClient.call` already unwraps the RPC envelope: it rejects on a
      // failed remote call and resolves to the remote's own result value, so
      // the library arrives here directly — it is never wrapped in
      // `{ ok, value }` (see `packages/app-runtime/src/dsh-client/index.ts`).
      const library = await client.call<DshPetLibrary>("amibaPets/list", {
        args: {},
      });
      this.library = library;
      this.emit(library);
    } catch {
      // Runtime not ready or transient carrier error — keep the last
      // snapshot and retry on the next tick.
    }
  }

  /** `amibaPets/activate`; the response carries the refreshed library. */
  async activate(id: string | null): Promise<void> {
    const client = await this.client();
    const library = await client.call<DshPetLibrary>("amibaPets/activate", {
      args: { id },
    });
    this.library = library;
    this.emit(library);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }
}

/** Long-poll `amibaNotifications/watch`, mirroring the plugin client loop. */
export class NotificationSource {
  private readonly subscriber = randomUUID();
  private cursor: { epoch: string; revision: number } | null = null;
  private rows: DshNotificationRow[] = [];
  private connection: "loading" | "connected" | "reconnecting" = "loading";
  private disposed = false;
  private generation = 0;
  private retry = 250;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private readonly listeners = new Set<() => void>();

  // Plain field + assignment instead of a constructor parameter property:
  // parameter properties need a transform, and the main-process test runner
  // imports these modules with `node --experimental-strip-types`.
  private readonly client: () => Promise<DshApiClient>;

  constructor(client: () => Promise<DshApiClient>) {
    this.client = client;
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): {
    rows: DshNotificationRow[];
    connection: "loading" | "connected" | "reconnecting";
  } {
    return { rows: this.rows, connection: this.connection };
  }

  start(): void {
    if (this.running) return;
    const token = this.generation;
    void (this.running = this.run(token).finally(() => {
      if (this.running) this.running = undefined;
    }));
  }

  private setConnection(next: typeof this.connection): void {
    if (this.connection === next) return;
    this.connection = next;
    this.emit();
  }

  private async run(token: number): Promise<void> {
    while (!this.disposed && token === this.generation) {
      try {
        const client = await this.client();
        // `DshApiClient.call` rejects on a failed remote call and resolves to
        // the update itself; a malformed payload counts as a dropped
        // subscription so the retry loop reconnects.
        const update = await client.call<DshNotificationUpdate>(
          "amibaNotifications/watch",
          { args: { after: this.cursor, subscriber: this.subscriber } },
        );
        if (this.disposed || token !== this.generation) return;
        if (
          !update ||
          typeof update !== "object" ||
          !update.cursor ||
          !Array.isArray(update.notifications) ||
          !Array.isArray(update.removed)
        )
          throw new Error("amibaNotifications/watch returned a malformed update");
        const changed =
          update.reset ||
          update.cursor.revision !== this.cursor?.revision ||
          update.cursor.epoch !== this.cursor?.epoch;
        if (changed) {
          const byId = new Map(
            (update.reset ? [] : this.rows).map((row) => [row.id, row]),
          );
          update.removed.forEach((id) => byId.delete(id));
          update.notifications.forEach((row) => byId.set(row.id, row));
          this.rows = [...byId.values()].sort(
            (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
          );
          this.cursor = update.cursor;
          this.emit();
        }
        this.setConnection("connected");
        this.retry = 250;
      } catch {
        if (this.disposed || token !== this.generation) return;
        this.setConnection("reconnecting");
        const delay = this.retry;
        this.retry = Math.min(this.retry * 2, 10_000);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          void this.run(token);
        }, delay);
        this.retryTimer.unref?.();
        return;
      }
    }
  }

  async dismiss(id: string): Promise<void> {
    const client = await this.client();
    await client.call("amibaNotifications/dismiss", { args: { id } });
  }

  async markSessionsRead(
    reads: Array<{ sessionId: string; readAt: number }>,
  ): Promise<void> {
    if (reads.length === 0) return;
    const client = await this.client();
    await client.call("amibaNotifications/markSessionsRead", {
      args: { reads },
    });
  }

  async resync(): Promise<void> {
    if (this.disposed) return;
    this.setConnection("reconnecting");
    const token = ++this.generation;
    this.cursor = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    try {
      const client = await this.client();
      await client.call("amibaNotifications/cancelWatch", {
        args: { subscriber: this.subscriber },
      });
    } catch {
      // A failed cancel is fine — the runtime drops stale subscribers.
    } finally {
      if (!this.disposed && token === this.generation) {
        void (this.running = this.run(token).finally(() => {
          if (this.running) this.running = undefined;
        }));
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.listeners.clear();
    // Best-effort server-side unsubscribe; failures are harmless.
    this.client()
      .then((client) =>
        client.call("amibaNotifications/cancelWatch", {
          args: { subscriber: this.subscriber },
        }),
      )
      .catch(() => {});
  }
}
