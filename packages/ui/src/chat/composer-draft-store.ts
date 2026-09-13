import { composerDraftDocument, decodeComposerDraft, updateLegacyDraftDocument, updatePublicDraftDocument, type ComposerDraftDocument } from "./composer-draft-document";
import type { ParsedPart } from "./composer/serialize";
import type { StorageAdapter } from "@amiba/app-runtime/platform";
import { ResidentInputProjection } from "./composer-resident-input";
import type { ComposerInputDraft } from "./composer/triggers/contracts";

export interface ComposerDraftSource {
  getSnapshot(): string;
  getDocument(): ComposerDraftDocument;
  /** Native document in official coordinates; used only without a mounted editor. */
  readInputDraft(): ComposerInputDraft;
  setParts(parts: readonly ParsedPart[]): void;
  /** Full visible text, preserving unedited references without parsing new tokens. */
  setDisplayText(text: string): void;
  subscribe(listener: () => void): () => void;
  set(value: string | ((previous: string) => string)): void;
}

/** Shared native draft; the document preserves literal text and reference identity. */
export function createComposerDraftSource(storage?: StorageAdapter, sessionId?: string): ComposerDraftSource {
  const key = sessionId ? `amiba.composer.draft.${sessionId}` : undefined;
  let document = composerDraftDocument([]);
  const inputProjection = new ResidentInputProjection();
  let inputDraft = inputProjection.update(document);
  let fingerprint = JSON.stringify(document);
  let revision = 0;
  let readGeneration = 0;
  let pendingWrites = 0;
  let writes = Promise.resolve();
  let offStorage: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ComposerDraftDocument): boolean => {
    const key = JSON.stringify(next);
    if (key === fingerprint) return false;
    document = next;
    inputDraft = inputProjection.update(next);
    fingerprint = key;
    for (const listener of listeners) listener();
    return true;
  };
  const save = (next: ComposerDraftDocument) => {
    if (!storage || !key) return;
    pendingWrites++;
    writes = writes.then(() => next.text === "" ? storage.remove(key) : storage.set({ [key]: { version: 2, ...next } }))
      .catch(error => console.warn("[composer] draft save failed", error))
      .finally(() => { pendingWrites--; });
  };
  const hydrate = () => {
    if (!storage || !key) return;
    const before = revision;
    const generation = ++readGeneration;
    void storage.get(key).then(values => {
      if (revision !== before || generation !== readGeneration || pendingWrites) return;
      const next = decodeComposerDraft(values[key]);
      if (next !== undefined) publish(next);
    }).catch(error => console.warn("[composer] draft restore failed", error));
  };
  return {
    getSnapshot: () => document.text,
    getDocument: () => document,
    readInputDraft: () => inputDraft,
    setParts(parts) {
      const next = composerDraftDocument(parts);
      if (JSON.stringify(next) === fingerprint) return;
      revision++;
      publish(next);
      save(next);
    },
    setDisplayText(text) {
      const next = updatePublicDraftDocument(document, text);
      revision++;
      if (publish(next) || text === "") save(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && storage && key) {
        offStorage = storage.watch(key, changes => {
          if (!(key in changes) || pendingWrites) return;
          const next = decodeComposerDraft(changes[key].newValue);
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
      const next = typeof value === "function" ? value(document.text) : value;
      // Explicit clears cancel pending restoration. An echoed editor value must
      // retain its document, including literal text that resembles a token.
      revision++;
      if (next === document.text && next !== "") return;
      const updated = updateLegacyDraftDocument(document, next);
      publish(updated);
      save(updated);
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
