import { $getRoot, $isElementNode, type LexicalNode } from "lexical";
import { $isMentionNode } from "./MentionNode";
import { encodeMention, type ParsedPart } from "./serialize";

/** Preserve text/mention identity before crossing the legacy string boundary. */
export function $readComposerParts(): ParsedPart[] {
  const parts: ParsedPart[] = [];
  const appendText = (text: string) => {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous?.kind === "text") previous.text += text;
    else parts.push({ kind: "text", text });
  };
  const visit = (node: LexicalNode): void => {
    if ($isElementNode(node)) {
      const children = node.getChildren();
      children.forEach((child, index) => {
        visit(child);
        if ($isElementNode(child) && !child.isInline() && index < children.length - 1) appendText("\n\n");
      });
    } else if ($isMentionNode(node)) {
      const value = node.getMention();
      const mention = { ...value, payload: { ...value.payload } };
      parts.push({ kind: "mention", mention, raw: encodeMention(mention) });
    } else appendText(node.getTextContent());
  };
  visit($getRoot());
  return parts;
}
