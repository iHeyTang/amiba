import {
  $getCharacterOffsets, $getSelection, $isDecoratorNode, $isElementNode,
  $isLineBreakNode, $isNodeSelection, $isRangeSelection, $isTextNode,
  COMMAND_PRIORITY_HIGH, COPY_COMMAND, CUT_COMMAND, type LexicalEditor,
} from "lexical";
import { $isMentionNode } from "./MentionNode";

/** Selection boundaries follow Lexical's MIT-licensed RangeSelection projection.
 * Copyright (c) Meta Platforms, Inc. and affiliates. See LICENSE.lexical.
 * Only official reference leaves use their owner's clipboard projection.
 */
export function $referenceClipboardText(): string | undefined {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) && !$isNodeSelection(selection)) return undefined;
  if ($isRangeSelection(selection) && selection.isCollapsed()) return undefined;
  const nodes = selection.getNodes();
  if (!nodes.some(node => $isMentionNode(node) && node.getMention().type === "dsh.reference")) return undefined;
  const content = (node: typeof nodes[number]) => {
    if (!$isMentionNode(node) || node.getMention().type !== "dsh.reference") return node.getTextContent();
    const mention = node.getMention();
    return mention.payload.clipboardText ?? `@${mention.display}`;
  };
  if ($isNodeSelection(selection)) return nodes.map(content).join("");
  const [anchor, focus] = $getCharacterOffsets(selection);
  const [start, end] = selection.isBackward() ? [focus, anchor] : [anchor, focus];
  let text = "", blockBoundary = true;
  nodes.forEach((node, index) => {
    if ($isElementNode(node) && !node.isInline()) {
      if (!blockBoundary) text += "\n";
      blockBoundary = !node.isEmpty();
      return;
    }
    blockBoundary = false;
    if ($isTextNode(node)) {
      let value = node.getTextContent();
      if (nodes.length === 1 && selection.anchor.type === "element" && selection.focus.type === "element" && selection.anchor.offset !== selection.focus.offset) {
        text += value;
        return;
      }
      if (index === nodes.length - 1) value = value.slice(0, end);
      if (index === 0) value = value.slice(start);
      text += value;
    } else if ($isDecoratorNode(node) || $isLineBreakNode(node)) text += content(node);
  });
  return text;
}

export function registerReferenceClipboard(editor: LexicalEditor): () => void {
  const copy = (event: ClipboardEvent | KeyboardEvent | null, cut: boolean): boolean => {
    const data = event && "clipboardData" in event ? event.clipboardData : null;
    if (!data || (cut && !editor.isEditable())) return false;
    const text = $referenceClipboardText();
    if (text === undefined) return false;
    // Never remove the selection unless the clipboard write succeeded.
    data.setData("text/plain", text);
    event!.preventDefault();
    if (cut) {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.removeText();
      else if ($isNodeSelection(selection)) selection.getNodes().forEach(node => node.remove());
    }
    return true;
  };
  const offCopy = editor.registerCommand(COPY_COMMAND, event => copy(event, false), COMMAND_PRIORITY_HIGH);
  const offCut = editor.registerCommand(CUT_COMMAND, event => copy(event, true), COMMAND_PRIORITY_HIGH);
  return () => { offCopy(); offCut(); };
}
