import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";
import { $createMentionNode } from "../MentionNode";
import type { MentionData } from "./types";

/**
 * Replace the open trigger run (e.g. "@trans") with a MentionNode + trailing
 * space.
 *
 * This is the IMPERATIVE insertion helper kept for EXTERNAL providers — the
 * host-contributed `mentionProviders` whose `onSelect(item, editor)` predates
 * the official pipeline and receives no token span. Amiba's own built-in
 * sources no longer use it: they return an official `{ insert }`
 * `PickOutcome` that the four scoped editor verbs apply against the exact
 * span the detector reported (see `triggers/editor-ops.ts`).
 */
export function insertMentionAtTrigger(
  editor: LexicalEditor,
  mention: MentionData,
) {
  editor.update(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
    const node = sel.anchor.getNode();
    const offset = sel.anchor.offset;
    const text = node.getTextContent();
    const before = text.slice(0, offset);
    const m = /([/@])([^\s]*)$/.exec(before);
    if (!m) return;
    const triggerStart = offset - m[0].length;
    if (typeof (node as { spliceText?: unknown }).spliceText === "function") {
      (
        node as unknown as {
          spliceText: (i: number, n: number, t: string) => void;
        }
      ).spliceText(triggerStart, m[0].length, "");
    }
    const chip = $createMentionNode(mention);
    sel.insertNodes([chip]);
    sel.insertText(" ");
  });
}
