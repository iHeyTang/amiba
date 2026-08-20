/**
 * The Lexical ⇄ official-draft coordinate bridge.
 *
 * The official trigger pipeline speaks in flat draft offsets: `track(draft,
 * caret, …)` detects a token span, and every pick outcome carries a
 * `TokenSpan { start, end, draftRev }` into that same string. Amiba's editor
 * is a Lexical tree, so every op here converts between the two.
 *
 * THE DRAFT PROJECTION. A mention chip contributes exactly ONE character —
 * U+FFFC (OBJECT REPLACEMENT CHARACTER) — to the trigger draft, which is the
 * official placeholder convention (`ReferenceInsert`: "the draft holds one
 * U+FFFC placeholder per occurrence"). This is NOT cosmetic:
 *
 *   - `MentionNode.getTextContent()` is the canonical `@[type:body]` TOKEN,
 *     because that string IS Amiba's persisted composer value. Feeding that
 *     to the official detector would make every chip re-trigger the menu (the
 *     detector scans left for `@` and would find the one that opens the
 *     token).
 *   - With a single placeholder the detector behaves exactly as upstream's:
 *     U+FFFC is neither whitespace nor a word char, so a trigger typed
 *     immediately after a chip opens normally, and a chip before the trigger
 *     correctly makes the hit `inline` rather than `leading`.
 *
 * So the trigger draft and the persisted `value` string are two projections
 * of one tree, and ALL span arithmetic happens in the trigger-draft space.
 */

import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalNode,
} from "lexical";

/** The single character a chip occupies in the trigger draft. */
export const PLACEHOLDER = "￼";

interface Leaf {
  node: LexicalNode;
  /** Inclusive start offset in the trigger draft. */
  start: number;
  /** Exclusive end offset in the trigger draft. */
  end: number;
  text: boolean;
}

export interface DraftScan {
  draft: string;
  leaves: Leaf[];
  /**
   * Content span of EVERY visited node, elements included. Recorded during
   * the one walk so no position lookup ever has to re-derive a boundary by
   * recursing through siblings and parents.
   */
  spans: Map<string, { start: number; end: number }>;
}

/**
 * Walk the tree in the exact order `ElementNode.getTextContent()` does
 * (children in order, `\n\n` after a non-inline element child that is not the
 * last), substituting one U+FFFC for every decorator leaf.
 */
export function $scanDraft(): DraftScan {
  const leaves: Leaf[] = [];
  const spans = new Map<string, { start: number; end: number }>();
  let draft = "";
  const visit = (node: LexicalNode): void => {
    const start = draft.length;
    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        visit(child);
        if (
          $isElementNode(child) &&
          i !== children.length - 1 &&
          !child.isInline()
        ) {
          draft += "\n\n";
        }
      }
    } else {
      const content = $isDecoratorNode(node)
        ? PLACEHOLDER
        : node.getTextContent();
      leaves.push({
        node,
        start,
        end: start + content.length,
        text: $isTextNode(node),
      });
      draft += content;
    }
    spans.set(node.getKey(), { start, end: draft.length });
  };
  visit($getRoot());
  return { draft, leaves, spans };
}

/**
 * Absolute trigger-draft offset of the collapsed selection, or `null` when
 * there is no collapsed range selection (nothing to detect a trigger under).
 */
export function $caretOffset(scan: DraftScan): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  const span = scan.spans.get(node.getKey());
  if (span === undefined) return null;
  if (anchor.type === "text") return span.start + anchor.offset;
  // Element point: `offset` is a child index, so the caret sits immediately
  // before that child (or at the element's end past the last child).
  if (!$isElementNode(node)) return null;
  const children = node.getChildren();
  if (children.length === 0 || anchor.offset >= children.length) {
    return span.end;
  }
  return scan.spans.get(children[anchor.offset].getKey())?.start ?? span.start;
}

/** Build a Lexical point at one trigger-draft offset. */
function pointAt(
  offset: number,
  scan: DraftScan,
): { node: LexicalNode; offset: number; type: "text" | "element" } | null {
  // Prefer a TEXT leaf containing the offset, so the point can sit inside a
  // run; fall back to the boundary of a non-text leaf.
  let boundary: { node: LexicalNode; offset: number; type: "element" } | null =
    null;
  for (const leaf of scan.leaves) {
    if (offset < leaf.start || offset > leaf.end) continue;
    if (leaf.text) return { node: leaf.node, offset: offset - leaf.start, type: "text" };
    const parent = leaf.node.getParent();
    if (parent === null) continue;
    const index = leaf.node.getIndexWithinParent();
    if (boundary === null) {
      boundary = {
        node: parent,
        offset: offset === leaf.start ? index : index + 1,
        type: "element",
      };
    }
  }
  if (boundary !== null) return boundary;
  // Empty document (no leaves at all): point at the root's first child slot.
  if (scan.leaves.length === 0 && offset === 0) {
    const root = $getRoot();
    const first = root.getFirstChild();
    if (first !== null && $isElementNode(first)) {
      return { node: first, offset: 0, type: "element" };
    }
    return { node: root, offset: 0, type: "element" };
  }
  return null;
}

/**
 * Replace the trigger-draft range `[start, end)` with `nodes` (empty = plain
 * deletion) and leave the caret after the insertion.
 *
 * @returns whether the TREE ACTUALLY CHANGED, measured by re-scanning the
 * draft afterwards — not inferred from a revision counter. A splice whose
 * result is byte-identical answers `false`, which is what the four scoped
 * bail events must report.
 */
export function $spliceTriggerRange(
  start: number,
  end: number,
  nodes: LexicalNode[],
): boolean {
  const scan = $scanDraft();
  if (start < 0 || start > end || end > scan.draft.length) return false;
  const from = pointAt(start, scan);
  const to = pointAt(end, scan);
  if (from === null || to === null) return false;
  const selection = $createRangeSelection();
  selection.anchor.set(from.node.getKey(), from.offset, from.type);
  selection.focus.set(to.node.getKey(), to.offset, to.type);
  $setSelection(selection);
  if (nodes.length === 0) selection.removeText();
  else selection.insertNodes(nodes);
  return $scanDraft().draft !== scan.draft;
}

/** Replace `[start, end)` with literal text. */
export function $spliceTriggerText(
  start: number,
  end: number,
  text: string,
): boolean {
  const scan = $scanDraft();
  if (start < 0 || start > end || end > scan.draft.length) return false;
  const from = pointAt(start, scan);
  const to = pointAt(end, scan);
  if (from === null || to === null) return false;
  const selection = $createRangeSelection();
  selection.anchor.set(from.node.getKey(), from.offset, from.type);
  selection.focus.set(to.node.getKey(), to.offset, to.type);
  $setSelection(selection);
  selection.insertText(text);
  return $scanDraft().draft !== scan.draft;
}
