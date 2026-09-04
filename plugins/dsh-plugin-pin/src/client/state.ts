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

export function createPinState(storage: StorageAdapter): PinState {
  let pinned: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const persist = () => storage.set({ [PIN_SESSION_IDS_KEY]: [...pinned] });

  return {
    async load() {
      try {
        const result = await storage.get([PIN_SESSION_IDS_KEY]);
        const value = result[PIN_SESSION_IDS_KEY];
        pinned = new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
      } catch {
        pinned = new Set();
      }
      notify();
    },
    isPinned: (sessionId) => pinned.has(sessionId),
    async pin(sessionId) {
      if (pinned.has(sessionId)) return;
      pinned = new Set(pinned).add(sessionId);
      notify();
      await persist();
    },
    async unpin(sessionId) {
      if (!pinned.has(sessionId)) return;
      const next = new Set(pinned);
      next.delete(sessionId);
      pinned = next;
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
