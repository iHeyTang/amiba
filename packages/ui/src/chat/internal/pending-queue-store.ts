import type { Attachment } from "@amiba/app-runtime/core";
import type { StorageAdapter } from "@amiba/app-runtime/platform";
import type { ComposerDraftDocument } from "../composer-draft-document";

export interface PendingChatTurn {
  queueId: string;
  needsResolution?: boolean;
  text: string;
  attachments: Attachment[];
  draft?: ComposerDraftDocument;
}
export const pendingQueueStorageKey = (sessionId: string) => `pendingQueue:${sessionId}`;
type Update = PendingChatTurn[] | ((previous: PendingChatTurn[]) => PendingChatTurn[]);
type Change = { replace: PendingChatTurn[] } | { removed: Set<string>; changed: Map<string, PendingChatTurn>; added: PendingChatTurn[] };

/** One renderer authority per storage adapter and session; persisted wire shape stays unchanged. */
export function createPendingQueueSource(storage: StorageAdapter, sessionId: string) {
  const key = pendingQueueStorageKey(sessionId);
  let snapshot: PendingChatTurn[] = [];
  // Runtime control belongs to the session too. It is deliberately separate
  // from the persisted row format and does not arm a queue after a restart.
  let paused = false;
  let loaded = false, revision = 0, generation = 0, pendingWrites = 0;
  let loading: Promise<void> | undefined;
  let writes = Promise.resolve();
  let hydrationChanges: Change[] = [];
  const listeners = new Set<() => void>();
  let offStorage: (() => void) | undefined;
  const decode = (raw: unknown): PendingChatTurn[] => Array.isArray(raw) ? raw.filter(row => row &&
    typeof row.queueId === "string" && typeof row.text === "string" && Array.isArray(row.attachments)) : [];
  const notify = () => {
    for (const listener of listeners) {
      try { listener(); }
      catch (error) { console.warn("[pending-queue] observer failed", error); }
    }
  };
  const publish = (next: PendingChatTurn[]) => {
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next;
    notify();
  };
  const persist = () => {
    const value = snapshot;
    pendingWrites++;
    const write = writes.catch(() => {}).then(() => value.length ? storage.set({ [key]: value }) : storage.remove(key));
    writes = write.finally(() => { pendingWrites--; });
    // Native synchronous mutations remain fire-and-forget. Explicit callers
    // can await flush() and must retain their draft on a persistence failure.
    void writes.catch(error => console.warn("[pending-queue] save failed", error));
  };
  const apply = (base: PendingChatTurn[], change: Change) => {
    if ("replace" in change) return change.replace;
    const next = base.filter(row => !change.removed.has(row.queueId)).map(row => change.changed.get(row.queueId) ?? row);
    const ids = new Set(next.map(row => row.queueId));
    return [...next, ...change.added.filter(row => !ids.has(row.queueId))];
  };
  const load = (refresh = false): Promise<void> => {
    if (loading) return loading;
    if (loaded && !refresh) return Promise.resolve();
    const token = ++generation, before = revision;
    const wasLoaded = loaded;
    loading = storage.get(key).then(values => {
      if (token !== generation || (wasLoaded && (before !== revision || pendingWrites))) return;
      let next = decode(values[key]);
      for (const change of hydrationChanges) next = apply(next, change);
      const changed = hydrationChanges.length > 0;
      hydrationChanges = [];
      loaded = true;
      publish(next);
      if (changed) persist();
    }).finally(() => { loading = undefined; });
    return loading;
  };
  return {
    getSnapshot: () => snapshot,
    isPaused: () => paused,
    setPaused(value: boolean) {
      if (paused === value) return;
      paused = value;
      notify();
    },
    ready: () => load(),
    flush: async () => { await load(); await writes; },
    update(action: Update) {
      const previous = snapshot;
      const next = typeof action === "function" ? action(previous) : action;
      if (next === previous) return;
      revision++;
      if (!loaded) {
        if (typeof action !== "function") hydrationChanges.push({ replace: next });
        else {
          const before = new Map(previous.map(row => [row.queueId, row]));
          const after = new Map(next.map(row => [row.queueId, row]));
          hydrationChanges.push({ removed: new Set(previous.filter(row => !after.has(row.queueId)).map(row => row.queueId)),
            changed: new Map(next.filter(row => before.has(row.queueId) && before.get(row.queueId) !== row).map(row => [row.queueId, row])),
            added: next.filter(row => !before.has(row.queueId)) });
        }
      }
      publish(next);
      if (loaded) persist();
      else void load().catch(error => console.warn("[pending-queue] load failed", error));
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        offStorage = storage.watch(key, changes => {
          if (!(key in changes) || pendingWrites || hydrationChanges.length) return;
          generation++; loaded = true;
          publish(decode(changes[key].newValue));
        });
        void load(true).catch(error => console.warn("[pending-queue] load failed", error));
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { offStorage?.(); offStorage = undefined; }
      };
    },
  };
}

const sources = new WeakMap<StorageAdapter, Map<string, ReturnType<typeof createPendingQueueSource>>>();
export function sessionPendingQueue(storage: StorageAdapter, sessionId: string) {
  let sessions = sources.get(storage);
  if (!sessions) { sessions = new Map(); sources.set(storage, sessions); }
  let source = sessions.get(sessionId);
  if (!source) { source = createPendingQueueSource(storage, sessionId); sessions.set(sessionId, source); }
  return source;
}
