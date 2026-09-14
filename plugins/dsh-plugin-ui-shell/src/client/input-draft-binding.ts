import type { TriggerEditorOps } from "@amiba/ui";

type Draft = ReturnType<NonNullable<TriggerEditorOps["readInputDraft"]>>;

/** Public IDs outlive one Lexical binding; trigger-menu revisions stay local. */
export interface InputDraftCursor {
  revision: number;
  occurrence: number;
  /** Last public projection, shared only within this session. */
  snapshot?: Draft;
}

export function bindInputDraft(ops: TriggerEditorOps, cursor: InputDraftCursor) {
  let offset: number | undefined;
  let previous: Draft | undefined;
  let snapshot: Draft | undefined;
  const ids = new Map<number, number>();
  const read = (): Draft | undefined => {
    const local = ops.readInputDraft?.();
    if (!local) return undefined;
    if (local === previous) return snapshot;
    offset ??= Math.max(0, cursor.revision + 1 - local.draftRev);
    const draftRev = local.draftRev + offset;
    cursor.revision = Math.max(cursor.revision, draftRev);
    // Only transfer identity at a binding boundary with an exactly unchanged
    // projection. During a binding, NodeKey/local IDs remain authoritative:
    // deleting and recreating an identical chip must still produce a new ID.
    const handoff = previous === undefined ? cursor.snapshot : undefined;
    const sameProjection = handoff?.draft === local.draft &&
      handoff.occurrences.length === local.occurrences.length &&
      local.occurrences.every((item, index) => {
        const old = handoff.occurrences[index];
        return old.source === item.source && old.ref === item.ref &&
          old.offset === item.offset && old.length === item.length &&
          old.label === item.label && old.clipboardText === item.clipboardText;
      });
    const occurrences = local.occurrences.map((occurrence, index) => {
      let id = ids.get(occurrence.occurrenceId);
      if (id === undefined) {
        id = sameProjection ? handoff!.occurrences[index].occurrenceId : ++cursor.occurrence;
        ids.set(occurrence.occurrenceId, id);
      }
      return id === occurrence.occurrenceId ? occurrence : Object.freeze({ ...occurrence, occurrenceId: id });
    });
    previous = local;
    snapshot = draftRev === local.draftRev && occurrences.every((item, index) => item === local.occurrences[index])
      ? local : Object.freeze({ ...local, draftRev, occurrences: Object.freeze(occurrences) });
    cursor.snapshot = snapshot;
    return snapshot;
  };
  // Reserve this binding's revision even without any current subscribers.
  read();
  return {
    read,
    write(text: string, expectedRevision?: number): boolean {
      if (expectedRevision === undefined) return ops.setInputDraft?.(text) ?? false;
      const current = read();
      if (!current || current.draftRev !== expectedRevision) return false;
      return ops.setInputDraft?.(text, expectedRevision - offset!) ?? false;
    },
  };
}
