import type { StorageAdapter } from "@amiba/app-runtime/platform";

export interface ComposerDraftSource {
  getSnapshot(): string;
  subscribe(listener: () => void): () => void;
  set(value: string | ((previous: string) => string)): void;
}

/** Native token text is lossless for both legacy mentions and official references. */
export function createComposerDraftSource(storage?: StorageAdapter, sessionId?: string): ComposerDraftSource {
  const key = sessionId ? `amiba.composer.draft.${sessionId}` : undefined;
  let text = "";
  let revision = 0;
  let readGeneration = 0;
  let pendingWrites = 0;
  let writes = Promise.resolve();
  let offStorage: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: string) => {
    if (next === text) return;
    text = next;
    for (const listener of listeners) listener();
  };
  const decode = (value: unknown): string | undefined => {
    if (value === undefined) return "";
    if (!value || typeof value !== "object") return undefined;
    const draft = value as { version?: unknown; text?: unknown };
    return draft.version === 1 && typeof draft.text === "string" ? draft.text : undefined;
  };
  const hydrate = () => {
    if (!storage || !key) return;
    const before = revision;
    const generation = ++readGeneration;
    void storage.get(key).then(values => {
      if (revision !== before || generation !== readGeneration || pendingWrites) return;
      const next = decode(values[key]);
      if (next !== undefined) publish(next);
    }).catch(error => console.warn("[composer] draft restore failed", error));
  };
  return {
    getSnapshot: () => text,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && storage && key) {
        offStorage = storage.watch(key, changes => {
          if (!(key in changes) || pendingWrites) return;
          const next = decode(changes[key].newValue);
          if (next === undefined) return;
          revision++;
          publish(next);
        });
        if (!pendingWrites) hydrate();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { offStorage?.(); offStorage = undefined; }
      };
    },
    set(value) {
      const next = typeof value === "function" ? value(text) : value;
      // An explicit empty edit also overrides a still-pending disk restore.
      revision++;
      publish(next);
      if (!storage || !key) return;
      pendingWrites++;
      writes = writes.then(() => next === "" ? storage.remove(key) : storage.set({ [key]: { version: 1, text: next } }))
        .catch(error => console.warn("[composer] draft save failed", error))
        .finally(() => { pendingWrites--; });
    },
  };
}

const stores = new WeakMap<StorageAdapter, Map<string, ComposerDraftSource>>();
export function sessionComposerDraft(storage: StorageAdapter, sessionId: string): ComposerDraftSource {
  let sessions = stores.get(storage);
  if (!sessions) { sessions = new Map(); stores.set(storage, sessions); }
  let source = sessions.get(sessionId);
  if (!source) { source = createComposerDraftSource(storage, sessionId); sessions.set(sessionId, source); }
  return source;
}
