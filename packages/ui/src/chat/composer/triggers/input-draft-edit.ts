import { atomicTextEdit } from "../atomic-text-edit";
import { $isDecoratorNode } from "lexical";
import { $isMentionNode } from "../MentionNode";
import { $scanDraft, $spliceTriggerText } from "./lexical-draft";

/** Replace a public display draft while preserving untouched native chips. */
export function $setInputDraft(next: string): boolean {
  const scan = $scanDraft();
  const segments: { start: number; end: number; nativeStart: number; nativeEnd: number; atomic: boolean }[] = [];
  let draft = "";
  let nativeCursor = 0;
  const append = (text: string, nativeStart: number, nativeEnd: number, atomic: boolean) => {
    const start = draft.length;
    draft += text;
    segments.push({ start, end: draft.length, nativeStart, nativeEnd, atomic });
  };
  for (const leaf of scan.leaves) {
    if (leaf.start > nativeCursor) append(scan.draft.slice(nativeCursor, leaf.start), nativeCursor, leaf.start, true);
    const mention = $isMentionNode(leaf.node) ? leaf.node.getMention() : undefined;
    const text = mention?.type === "dsh.reference" && mention.payload.source && mention.payload.ref
      ? `@${mention.display}` : leaf.node.getTextContent();
    append(text, leaf.start, leaf.end, $isDecoratorNode(leaf.node));
    nativeCursor = leaf.end;
  }
  if (nativeCursor < scan.draft.length) append(scan.draft.slice(nativeCursor), nativeCursor, scan.draft.length, true);
  const edit = atomicTextEdit(draft, next, segments.filter(segment => segment.atomic));
  if (!edit) return false;
  const { from, to } = edit;
  const nativeOffset = (offset: number): number | undefined => {
    for (const segment of segments) {
      if (offset === segment.start) return segment.nativeStart;
      if (offset === segment.end) return segment.nativeEnd;
      if (!segment.atomic && offset > segment.start && offset < segment.end) return segment.nativeStart + offset - segment.start;
    }
    return offset === 0 && !segments.length ? 0 : undefined;
  };
  const nativeFrom = nativeOffset(from);
  const nativeTo = nativeOffset(to);
  if (nativeFrom === undefined || nativeTo === undefined) return false;
  return $spliceTriggerText(nativeFrom, nativeTo, edit.text);
}
