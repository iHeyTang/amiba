import { composerDraftDocument, decodeComposerDraft, updateLegacyDraftDocument, updatePublicDraftDocument, type ComposerDraftDocument } from "./composer-draft-document";
import type { ParsedPart } from "./composer/serialize";
import type { StorageAdapter } from "@amiba/app-runtime/platform";
import { ResidentInputProjection } from "./composer-resident-input";
import type { ComposerInputDraft } from "./composer/triggers/contracts";

export interface ComposerDraftSource {
  getSnapshot(): string;
  getDocument(): ComposerDraftDocument;
  /** Successful consumption is distinct from an ordinary, undoable draft edit. */
  commitSend?(document: ComposerDraftDocument): boolean;
  getHistoryVersion?(): number;
  /** Native document in official coordinates; used only without a mounted editor. */
  readInputDraft(): ComposerInputDraft;
  setParts(parts: readonly ParsedPart[]): void;
  /** Full visible text, preserving unedited references without parsing new tokens. */
  setDisplayText(text: string): void;
  subscribe(listener: () => void): () => void;
  set(value: string | ((previous: string) => string)): void;
}

type NativeComposerDraftSource = ComposerDraftSource & Required<Pick<ComposerDraftSource, "commitSend" | "getHistoryVersion">> & { attach(storage: StorageAdapter, sessionId: string): void };

/** Cheap exact document equality: text plus per-part comparison, avoiding
 * a full JSON.stringify of the whole draft on every keystroke (O(n) text). */
function sameDocument(a: ComposerDraftDocument, b: ComposerDraftDocument): boolean {
  if (a.text !== b.text) return false;
  const pa = a.parts, pb = b.parts;
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) {
    const p = pa[i]!, q = pb[i]!;
    if (p === q) continue;
    if (p.kind !== q.kind) return false;
    if (p.kind === "text") { if (p.text !== q.text) return false; continue; }
    if (p.raw !== q.raw) return false;
    if (p.mention?.type !== q.mention?.type || p.mention?.display !== q.mention?.display) return false;
    const ps = p.mention?.payload, qs = q.mention?.payload;
    if ((ps?.source ?? null) !== (qs?.source ?? null) || (ps?.ref ?? null) !== (qs?.ref ?? null)) return false;
  }
  return true;
}

/** Shared native draft; the document preserves literal text and reference identity. */
export function createComposerDraftSource(storage?: StorageAdapter, sessionId?: string): NativeComposerDraftSource {
  let key = sessionId ? `amiba.composer.draft.${sessionId}` : undefined;
  let document = composerDraftDocument([]);
  const inputProjection = new ResidentInputProjection();
  let inputDraft = inputProjection.update(document);
  let revision = 0;
  let historyVersion = 0;
  let readGeneration = 0;
  let pendingWrites = 0;
  let writes = Promise.resolve();
  let offStorage: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const retainedReferencesMoved = (next: ComposerDraftDocument): boolean => {
    const previous = new Map(document.parts.filter(part => part.kind === "mention")
      .map((part, index) => [part, index]));
    return next.parts.filter(part => part.kind === "mention").some((part, index) =>
      previous.has(part) && previous.get(part) !== index);
  };
  const publish = (next: ComposerDraftDocument): boolean => {
    if (sameDocument(next, document) && !retainedReferencesMoved(next)) return false;
    document = next;
    inputDraft = inputProjection.update(next);
    for (const listener of listeners) listener();
    return true;
  };
  const save = (next: ComposerDraftDocument) => {
    if (!storage || !key) return;
    const adapter = storage, draftKey = key;
    pendingWrites++;
    writes = writes.then(() => next.text === "" ? adapter.remove(draftKey) : adapter.set({ [draftKey]: { version: 2, ...next } }))
      .catch(error => console.warn("[composer] draft save failed", error))
      .finally(() => { pendingWrites--; });
  };
  const hydrate = () => {
    if (!storage || !key) return;
    const draftKey = key;
    const before = revision;
    const generation = ++readGeneration;
    void storage.get(key).then(values => {
      if (revision !== before || generation !== readGeneration || pendingWrites) return;
      const next = decodeComposerDraft(values[draftKey]);
      if (next !== undefined) publish(next);
    }).catch(error => console.warn("[composer] draft restore failed", error));
  };
  const watch = () => {
    offStorage?.();
    if (!storage || !key || !listeners.size) return;
    const currentKey = key;
    offStorage = storage.watch(currentKey, changes => {
      if (!(currentKey in changes) || pendingWrites) return;
      const next = decodeComposerDraft(changes[currentKey].newValue);
      if (next === undefined) return;
      revision++;
      publish(next);
    });
  };
  return {
    attach(adapter, id) {
      storage = adapter;
      key = `amiba.composer.draft.${id}`;
      // The prepared draft is authoritative; do not hydrate or publish an old
      // empty value during handoff. Subsequent ordinary edits persist normally.
      readGeneration++;
      watch();
    },
    getSnapshot: () => document.text,
    getDocument: () => document,
    getHistoryVersion: () => historyVersion,
    commitSend(expected) {
      if (document !== expected) return false;
      revision++;
      historyVersion++;
      const empty = composerDraftDocument([]);
      if (!publish(empty)) for (const listener of listeners) listener();
      save(empty);
      return true;
    },
    readInputDraft: () => inputDraft,
    setParts(parts) {
      const next = composerDraftDocument(parts);
      // Serialized equality cannot hide a move of a known occurrence. Fresh
      // equivalent editor/storage echoes still retain the current document.
      if (sameDocument(next, document) && !retainedReferencesMoved(next)) return;
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
        watch();
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

const stores = new WeakMap<StorageAdapter, Map<string, NativeComposerDraftSource>>();
export function sessionComposerDraft(storage: StorageAdapter, sessionId: string): NativeComposerDraftSource {
  let sessions = stores.get(storage);
  if (!sessions) { sessions = new Map(); stores.set(storage, sessions); }
  let source = sessions.get(sessionId);
  if (!source) { source = createComposerDraftSource(storage, sessionId); sessions.set(sessionId, source); }
  return source;
}

// Only the preparation interval has no session ID. This pointer follows the
// same source registered under the prepared session, not a second draft copy.
const homeStores = new WeakMap<StorageAdapter, NativeComposerDraftSource>();
export function homeComposerDraft(storage: StorageAdapter): NativeComposerDraftSource {
  let source = homeStores.get(storage);
  if (!source) {
    source = createComposerDraftSource();
    homeStores.set(storage, source);
  }
  return source;
}

/** Adopt the preparation draft into the canonical session registry, preserving
 * editor history, reference identity, and in-flight attachment ownership. */
export function bindHomeComposerDraft(storage: StorageAdapter, sessionId: string) {
  const source = homeComposerDraft(storage);
  let sessions = stores.get(storage);
  if (!sessions) { sessions = new Map(); stores.set(storage, sessions); }
  for (const [id, previous] of sessions) {
    if (previous === source && id !== sessionId) sessions.delete(id);
  }
  sessions.set(sessionId, source);
  return source;
}

export function finishHomeComposerDraft(storage: StorageAdapter, sessionId: string, source: ReturnType<typeof homeComposerDraft>, submitted: ComposerDraftDocument) {
  // A later Home may already have moved this source to a different workspace.
  // The old send owns its payload, not that new draft or its persistence key.
  if (stores.get(storage)?.get(sessionId) !== source) return source;
  const next = createComposerDraftSource();
  if (!source.commitSend(submitted)) {
    // Edits made while the storage handoff was pending belong to the next Home
    // draft. The receiver will populate this session with the submitted text.
    next.setParts(source.getDocument().parts);
    source.commitSend(source.getDocument());
  }
  if (homeStores.get(storage) === source) homeStores.set(storage, next);
  source.attach(storage, sessionId);
  return next;
}
