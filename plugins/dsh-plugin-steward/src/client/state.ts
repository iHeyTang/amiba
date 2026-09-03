/** Tiny client-side cache: the steward session id and which sessions are already managed. */
export interface StewardClientState {
  stewardSessionId(): string | null;
  setStewardSessionId(id: string): void;
  adoptedSessionIds(): ReadonlySet<string>;
  setAdopted(ids: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
}

export function createStewardClientState(): StewardClientState {
  let stewardId: string | null = null;
  let adopted: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    stewardSessionId: () => stewardId,
    setStewardSessionId(id) {
      stewardId = id;
      notify();
    },
    adoptedSessionIds: () => adopted,
    setAdopted(ids) {
      adopted = new Set(ids);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
