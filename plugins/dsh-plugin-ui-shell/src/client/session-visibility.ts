/**
 * `ctx.amibaSessionVisibility`: lets a feature plugin keep every session
 * bound to one of its agent presets out of the chat history list. The
 * product shell subscribes to `source` and hands the set to
 * `<FullScreenChatView hiddenSessionPresets>`; sessions stay openable by id.
 */
export interface AmibaSessionVisibility {
  /** Hide sessions whose agent preset is `presetId`; returns the disposer. */
  hidePreset(presetId: string): () => void;
  hiddenPresets(): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
}

export interface HiddenPresetsSource {
  getSnapshot: () => ReadonlySet<string>;
  subscribe: (listener: () => void) => () => void;
}

export function createSessionVisibility(): AmibaSessionVisibility & { source: HiddenPresetsSource } {
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
    hidePreset(presetId) {
      const id = presetId.trim();
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
    hiddenPresets: () => snapshot,
    subscribe,
    source: { getSnapshot: () => snapshot, subscribe },
  };
}
