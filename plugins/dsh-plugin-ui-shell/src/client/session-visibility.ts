/**
 * `ctx.amibaSessionVisibility`: lets a feature plugin keep every session
 * identified by its owned session IDs out of the chat history list. The
 * product shell subscribes to `source` and hands the set to
 * `<FullScreenChatView hiddenSessionIds>`; sessions stay openable by id.
 */
export interface AmibaSessionVisibility {
  /** Hide exactly the owned `sessionId`; returns the disposer. */
  hideSession(sessionId: string): () => void;
  hiddenSessions(): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
}

export interface HiddenSessionsSource {
  getSnapshot: () => ReadonlySet<string>;
  subscribe: (listener: () => void) => () => void;
}

export function createSessionVisibility(): AmibaSessionVisibility & { source: HiddenSessionsSource } {
  const counts = new Map<string, number>();
  const listeners = new Set<() => void>();
  let snapshot: ReadonlySet<string> = new Set();
  const publish = () => {
    snapshot = new Set(counts.keys());
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    hideSession(sessionId) {
      const id = sessionId.trim();
      counts.set(id, (counts.get(id) ?? 0) + 1);
      publish();
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        const next = (counts.get(id) ?? 1) - 1;
        if (next <= 0) counts.delete(id);
        else counts.set(id, next);
        publish();
      };
    },
    hiddenSessions: () => snapshot,
    subscribe,
    source: { getSnapshot: () => snapshot, subscribe },
  };
}
