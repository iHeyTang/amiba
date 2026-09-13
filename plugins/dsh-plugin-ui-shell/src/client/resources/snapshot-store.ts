import type { ObservableSnapshot } from '@amiba/extension-sdk';

/** The resource registry only replaces complete snapshots; it does not use drafts or persistence. */
export interface ResourceSnapshotStore<T> extends ObservableSnapshot<T> {
  set(next: T): void;
}

export function createResourceSnapshotStore<T>(initial: T): ResourceSnapshotStore<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next) {
      if (Object.is(snapshot, next)) return;
      snapshot = next;
      for (const listener of [...listeners]) {
        try { listener(); }
        catch (error) { console.error('[resources] subscriber failed:', error); }
      }
    },
  };
}
