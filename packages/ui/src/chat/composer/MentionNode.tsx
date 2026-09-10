import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical"
import type { ReactNode } from "react"
import { encodeMention } from "./serialize"
import type { MentionData } from "./providers/types"
import { cn } from "../../primitives"
import { ReferenceButton } from "../../reference-request"

export type SerializedMentionNode = Spread<{ mention: MentionData }, SerializedLexicalNode>

export class MentionNode extends DecoratorNode<ReactNode> {
  __mention: MentionData

  static getType(): string { return "amiba-mention" }
  static clone(node: MentionNode): MentionNode { return new MentionNode(node.__mention, node.__key) }

  constructor(mention: MentionData, key?: NodeKey) {
    super(key)
    this.__mention = mention
  }

  getMention(): MentionData { return this.__mention }

  // Serialized text form == the canonical token, so getRoot().getTextContent()
  // yields the value string with tokens inline.
  getTextContent(): string { return encodeMention(this.__mention) }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    span.style.display = "inline-block"
    return span
  }
  updateDOM(): false { return false }
  isInline(): true { return true }

  exportJSON(): SerializedMentionNode {
    return { type: MentionNode.getType(), version: 1, mention: this.__mention }
  }
  static importJSON(json: SerializedMentionNode): MentionNode {
    return new MentionNode(json.mention)
  }

  decorate(): ReactNode {
    const m = this.__mention
    if (m.type === "dsh.reference") return <span contentEditable={false}><ReferenceButton source={m.payload.source ?? ""} reference={m.payload.ref ?? ""}>@{m.display}</ReferenceButton></span>
    return (
      <span
        className={cn(
          "inline-flex h-5 items-center rounded-md border border-border bg-muted/50 px-1 align-baseline text-[12px] text-foreground",
        )}
        data-mention-type={m.type}
        contentEditable={false}
      >
        @{m.display}
      </span>
    )
  }
}

export function $createMentionNode(mention: MentionData): MentionNode {
  return new MentionNode(mention)
}
export function $isMentionNode(node: unknown): node is MentionNode {
  return node instanceof MentionNode
}
