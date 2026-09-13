import { composerDraftDisplayText, type ComposerDraftDocument } from "./composer-draft-document";
import { atomicTextEdit } from "./composer/atomic-text-edit";
import type { ComposerInputDraft } from "./composer/triggers/contracts";

/** Projection of the native document after its editor/command owner is released. */
export class ResidentInputProjection {
  private nextId = 0;
  private snapshot: ComposerInputDraft | undefined;

  update(document: ComposerDraftDocument): ComposerInputDraft {
    const previous = this.snapshot;
    const draft = composerDraftDisplayText(document);
    const edit = previous && atomicTextEdit(previous.draft, draft,
      previous.occurrences.map(item => ({ start: item.offset, end: item.offset + item.length })));
    const delta = edit ? edit.text.length - (edit.to - edit.from) : 0;
    const candidates = new Map<number, ComposerInputDraft["occurrences"][number]>();
    for (const item of previous?.occurrences ?? []) {
      if (!edit || item.offset + item.length <= edit.from) candidates.set(item.offset, item);
      else if (item.offset >= edit.to) candidates.set(item.offset + delta, item);
    }
    let offset = 0;
    const occurrences: ComposerInputDraft["occurrences"][number][] = [];
    for (const part of document.parts) {
      if (part.kind === "text") { offset += part.text.length; continue; }
      const { mention } = part;
      if (mention.type !== "dsh.reference" || !mention.payload.source || !mention.payload.ref) {
        offset += part.raw.length;
        continue;
      }
      const text = `@${mention.display}`;
      const value = { source: mention.payload.source, ref: mention.payload.ref, offset,
        length: text.length, label: mention.display, clipboardText: mention.payload.clipboardText ?? text };
      const candidate = candidates.get(offset);
      const same = candidate && candidate.source === value.source && candidate.ref === value.ref &&
        candidate.label === value.label && candidate.clipboardText === value.clipboardText;
      occurrences.push(Object.freeze({ ...value, occurrenceId: same ? candidate.occurrenceId : ++this.nextId }));
      offset += text.length;
    }
    if (previous && previous.draft === draft && JSON.stringify(previous.occurrences) === JSON.stringify(occurrences)) return previous;
    return this.snapshot = Object.freeze({ draft, draftRev: previous ? previous.draftRev + 1 : 0,
      phase: "plain", occurrences: Object.freeze(occurrences) });
  }
}
