import type { StorageAdapter } from "@amiba/app-runtime/platform";

/** Platform storage key: a plain `string[]` of pinned session ids. */
export const PIN_SESSION_IDS_KEY = "pin.sessionIds";

/**
 * Tiny observable client-side cache of the pinned-session set, backed by
 * the platform's storage adapter (see `index.tsx`'s `apply()`, which reads
 * `getPlatform().storage` and passes it in here). Takes the
 * `StorageAdapter` as a parameter rather than reaching for the platform
 * itself so it stays unit-testable with a fake.
 */
export interface PinState {
  /** Reads the persisted set once (tolerates a missing or malformed value). */
  load(): Promise<void>;
  isPinned(sessionId: string): boolean;
  pin(sessionId: string): Promise<void>;
  unpin(sessionId: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function createPinState(storage: StorageAdapter): PinState {
  let pinned: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const persist = () => storage.set({ [PIN_SESSION_IDS_KEY]: [...pinned] });

  // `load()` is async (one storage round-trip) but `index.tsx` wires the
  // interactive faces right away, so a `pin()`/`unpin()` can land while a
  // load is still in flight. Without tracking that, `load()`'s unconditional
  // `pinned = new Set(<read>)` would silently revert the racing mutation
  // once the read resolves, and the racing mutation's own
  // `persist()` — which wrote only the pre-load `pinned` snapshot — could
  // itself have dropped ids that were already durably stored but not yet
  // loaded into memory. `version`/`pinnedSinceLoad`/`unpinnedSinceLoad` let
  // `load()` merge the read with whatever happened while it was in flight,
  // and re-persist the union when that happened, instead of clobbering
  // either side.
  let loading = false;
  let version = 0;
  let pinnedSinceLoad = new Set<string>();
  let unpinnedSinceLoad = new Set<string>();

  return {
    async load() {
      const startVersion = version;
      loading = true;
      pinnedSinceLoad = new Set();
      unpinnedSinceLoad = new Set();
      let loaded: Set<string>;
      try {
        const result = await storage.get([PIN_SESSION_IDS_KEY]);
        const value = result[PIN_SESSION_IDS_KEY];
        loaded = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
      } catch {
        loaded = new Set();
      }
      loading = false;
      const merged = new Set(loaded);
      for (const id of pinnedSinceLoad) merged.add(id);
      for (const id of unpinnedSinceLoad) merged.delete(id);
      pinnedSinceLoad = new Set();
      unpinnedSinceLoad = new Set();

      const changed = !sameSet(pinned, merged);
      const raced = version !== startVersion;
      pinned = merged;
      if (changed) notify();
      // A mutation raced the load: its own `persist()` wrote a snapshot
      // taken before (or mid-way through) this merge, so storage may still
      // hold that partial write. Re-persist the merged, authoritative set
      // so storage converges on the union rather than the last writer.
      if (raced) await persist();
    },
    isPinned: (sessionId) => pinned.has(sessionId),
    async pin(sessionId) {
      if (pinned.has(sessionId)) return;
      version++;
      pinned = new Set(pinned).add(sessionId);
      if (loading) {
        pinnedSinceLoad.add(sessionId);
        unpinnedSinceLoad.delete(sessionId);
      }
      notify();
      await persist();
    },
    async unpin(sessionId) {
      if (!pinned.has(sessionId)) return;
      version++;
      const next = new Set(pinned);
      next.delete(sessionId);
      pinned = next;
      if (loading) {
        unpinnedSinceLoad.add(sessionId);
        pinnedSinceLoad.delete(sessionId);
      }
      notify();
      await persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
