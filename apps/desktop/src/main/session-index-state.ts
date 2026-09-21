/** Window-independent session facts and the shared global event subscription.
 * Subscribe before taking a snapshot, replay concurrent deltas over it, and
 * reconcile on reconnect. A slow fallback covers durable deletion / preset
 * changes which the current host does not consistently emit.
 */
import type { DshApiClient, DshMuxEnvelope, DshMuxFrame, DshSessionSummary } from "@amiba/app-runtime/dsh-client";
import type { DshSessionRow } from "./dsh-state/types";

type Client = Pick<DshApiClient, "listSessions" | "events">;
const RETRY_MS = 2_000;
const RECONCILE_MS = 30_000;

function row(item: DshSessionSummary): DshSessionRow {
  return {
    sessionId: item.sessionId, updatedAt: item.updatedAt, running: item.running, blank: item.blank,
    ...(item.parentSessionId === undefined ? {} : { parentSessionId: item.parentSessionId }),
    ...(item.agentPreset === undefined ? {} : { agentPreset: item.agentPreset }),
    ...(typeof item.projections?.values?.title === "string" ? { title: item.projections.values.title } : {}),
  };
}

export class SessionIndex {
  private rows: DshSessionRow[] = [];
  private byId = new Map<string, DshSessionRow>();
  private readonly listeners = new Set<(rows: DshSessionRow[]) => void>();
  private readonly eventListeners = new Set<(event: DshMuxEnvelope) => void>();
  private readonly initialInteractions = new Map<string, DshMuxEnvelope>();
  private readonly lifetime = new AbortController();
  private readonly client: () => Promise<Client>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;
  private replay: DshMuxFrame[] = [];
  private reconcileAgain = false;
  private started = false;
  private connected = false;
  private hasSnapshot = false;

  constructor(client: () => Promise<Client>) { this.client = client; }

  start(): void {
    if (this.started || this.lifetime.signal.aborted) return;
    this.started = true;
    // The ready frame initiates the first list. If events cannot connect,
    // still supply authoritative snapshots while retrying the carrier.
    this.schedule(RETRY_MS);
    void this.follow();
  }

  onChange(listener: (rows: DshSessionRow[]) => void): () => void {
    this.listeners.add(listener);
    if (this.hasSnapshot) listener(this.rows);
    return () => { this.listeners.delete(listener); };
  }

  onEvent(listener: (event: DshMuxEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  getSnapshot(): DshSessionRow[] { return this.rows; }
  running(id: string): boolean { return this.byId.get(id)?.running ?? false; }
  parent(id: string): string | undefined { return this.byId.get(id)?.parentSessionId; }

  dispose(): void {
    this.lifetime.abort();
    clearTimeout(this.timer);
    this.listeners.clear();
    this.eventListeners.clear();
    this.initialInteractions.clear();
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    if (this.lifetime.signal.aborted) return;
    this.timer = setTimeout(() => { void this.refresh(); }, delay);
    this.timer.unref?.();
  }

  private async follow(): Promise<void> {
    const signal = this.lifetime.signal;
    while (!signal.aborted) {
      try {
        const client = await this.client();
        if (signal.aborted) return;
        for await (const event of client.events(signal, () => {
          this.connected = true;
          // A new carrier replays current pending interactions. Do not retain
          // a request cancelled while the initial connection was unavailable.
          if (!this.hasSnapshot) this.initialInteractions.clear();
          if (this.pending) this.reconcileAgain = true;
          else void this.refresh();
        })) {
          if (signal.aborted) return;
          const frame = event.payload;
          if (this.pending && this.isDelta(frame)) this.replay.push(frame);
          // Do not publish partial cold-start rows. ActivitySource must see
          // one complete initial baseline, not mistake restored old sessions
          // arriving individually for new post-startup conversation activity.
          if (this.isDelta(frame) && this.hasSnapshot) {
            const next = new Map(this.byId);
            if (!this.apply(next, frame)) this.requestReconcile();
            this.publish(next);
          } else if (this.isDelta(frame) && !this.pending) {
            this.requestReconcile();
          } else if (frame.type === "session/removed") {
            // Disposed means unloaded from the live registry, not deleted
            // from durable history. Only session/list can remove its row.
            this.requestReconcile();
          }
          this.dispatch(event);
        }
      } catch {
        // Runtime restart / dropped carrier: preserve state until resnapshot.
      }
      this.connected = false;
      this.schedule(RETRY_MS);
      if (signal.aborted) return;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, RETRY_MS);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }

  private dispatch(event: DshMuxEnvelope): void {
    if (!this.hasSnapshot) {
      const frame = event.payload;
      // ActivitySource cannot select a session before its first index. Retain
      // pending waits until that baseline, including cancellation in the gap.
      if (frame.type === "approval/requested") {
        this.initialInteractions.set(`approval:${frame.approvalId}`, event); return;
      }
      if (frame.type === "approval/resolved") {
        this.initialInteractions.delete(`approval:${frame.approvalId}`); return;
      }
      if (frame.type === "question/requested") {
        this.initialInteractions.set(`question:${event.rpcId}`, event); return;
      }
      if (frame.type === "question/resolved") {
        this.initialInteractions.delete(`question:${frame.questionRpcId}`); return;
      }
    }
    for (const listener of this.eventListeners) listener(event);
  }

  private isDelta(frame: DshMuxFrame): boolean {
    return frame.type === "session/added" || frame.type === "session/status" ||
      frame.type === "session/activity" || (frame.type === "session/projection" && (frame.key === "title" || frame.key === "sessionListMetadata"));
  }

  private apply(rows: Map<string, DshSessionRow>, frame: DshMuxFrame): boolean {
    if (frame.type === "session/added") { rows.set(frame.summary.sessionId, row(frame.summary)); return true; }
    if (!("sessionId" in frame)) return true;
    const previous = rows.get(frame.sessionId);
    if (!previous) return false;
    if (frame.type === "session/status") rows.set(frame.sessionId, { ...previous, running: frame.running });
    else if (frame.type === "session/activity") rows.set(frame.sessionId, {
      ...previous, updatedAt: Math.max(previous.updatedAt, frame.updatedAt),
    });
    else if (frame.type === "session/projection" && frame.key === "sessionListMetadata") {
      const metadata = frame.value as { blank?: boolean; lastPromptAt?: number | null } | null;
      if (metadata && typeof metadata.blank === "boolean") rows.set(frame.sessionId, {
        ...previous, blank: metadata.blank,
        updatedAt: typeof metadata.lastPromptAt === "number" ? Math.max(previous.updatedAt, metadata.lastPromptAt) : previous.updatedAt,
      });
    }
    else if (frame.type === "session/projection" && frame.key === "title" && typeof frame.value === "string") {
      rows.set(frame.sessionId, { ...previous, title: frame.value });
    }
    return true;
  }

  private requestReconcile(): void {
    if (this.pending) this.reconcileAgain = true;
    else this.schedule(50); // coalesce bursts of unknown IDs / unloads
  }

  private publish(next: Map<string, DshSessionRow>, baseline = false): void {
    if (this.lifetime.signal.aborted) return;
    const rows = [...next.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId));
    const changed = JSON.stringify(rows) !== JSON.stringify(this.rows);
    const first = baseline && !this.hasSnapshot;
    if (baseline) this.hasSnapshot = true;
    if (!changed && !first) return;
    this.byId = next;
    this.rows = rows;
    for (const listener of this.listeners) listener(rows);
    if (first) {
      const interactions = [...this.initialInteractions.values()];
      this.initialInteractions.clear();
      for (const event of interactions) this.dispatch(event);
    }
  }

  private refresh(): Promise<void> {
    if (this.lifetime.signal.aborted) return Promise.resolve();
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    this.replay = [];
    this.pending = (async () => {
      let success = false;
      try {
        const client = await this.client();
        if (this.lifetime.signal.aborted) return;
        const { items } = await client.listSessions(AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]));
        const rows = new Map(items.map(item => [item.sessionId, row(item)]));
        for (const frame of this.replay) this.apply(rows, frame);
        this.publish(rows, true);
        success = true;
      } catch {
        // Keep last state and retry; do not present a failed read as deletion.
      } finally {
        this.pending = undefined;
        this.replay = [];
        const again = this.reconcileAgain;
        this.reconcileAgain = false;
        this.schedule(again ? 50 : success && this.connected ? RECONCILE_MS : RETRY_MS);
      }
    })();
    return this.pending;
  }
}
