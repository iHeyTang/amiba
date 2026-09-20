/**
 * Small LRU for loaded session histories.
 *
 * Entries are only ever reused when the backend proves they are still current
 * (the history read reports the same projection revision), so this module stays
 * deliberately dumb: it stores, reuses and evicts — it never decides staleness.
 */
export interface LoadedHistoryCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  size(): number;
}

export function createLoadedHistoryCache<T>(limit = 3): LoadedHistoryCache<T> {
  const entries = new Map<string, T>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      // Refresh recency on hit.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > Math.max(1, limit)) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    size() {
      return entries.size;
    },
  };
}
