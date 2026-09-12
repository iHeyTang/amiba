import { $getRoot, $isElementNode, type LexicalNode } from "lexical";
import { $isMentionNode } from "../MentionNode";
import type { ComposerInputDraft } from "./contracts";

/** Public input uses full @labels; trigger-menu spans retain their own space. */
export class InputDraftProjection {
  private nextId = 0;
  private readonly ids = new Map<string, number>();
  private snapshot: ComposerInputDraft | undefined;
  private fingerprint = "";

  read(draftRev: number): ComposerInputDraft {
    let draft = "";
    const occurrences: ComposerInputDraft["occurrences"][number][] = [];
    const visit = (node: LexicalNode): void => {
      if ($isElementNode(node)) {
        const children = node.getChildren();
        children.forEach((child, index) => {
          visit(child);
          if ($isElementNode(child) && !child.isInline() && index < children.length - 1) draft += "\n\n";
        });
        return;
      }
      if ($isMentionNode(node)) {
        const mention = node.getMention();
        if (mention.type === "dsh.reference" && mention.payload.source && mention.payload.ref) {
          const label = mention.display;
          const text = `@${label}`;
          const key = node.getKey();
          let occurrenceId = this.ids.get(key);
          if (occurrenceId === undefined) { occurrenceId = ++this.nextId; this.ids.set(key, occurrenceId); }
          occurrences.push({ occurrenceId, source: mention.payload.source, ref: mention.payload.ref,
            offset: draft.length, length: text.length, label, clipboardText: mention.payload.clipboardText ?? text });
          draft += text;
          return;
        }
      }
      // Legacy/native chips without an official source retain their lossless
      // persisted token. Do not invent a reference codec or owner for them.
      draft += node.getTextContent();
    };
    visit($getRoot());
    const next = { draft, draftRev, occurrences };
    const fingerprint = JSON.stringify(next);
    if (this.snapshot && fingerprint === this.fingerprint) return this.snapshot;
    this.fingerprint = fingerprint;
    this.snapshot = Object.freeze({ ...next, occurrences: Object.freeze(occurrences.map((occurrence) => Object.freeze(occurrence))) });
    return this.snapshot;
  }
}
