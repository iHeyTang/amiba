import { createEditor } from "lexical"
import { describe, expect, it } from "vitest"
import { $createMentionNode, $isMentionNode, MentionNode } from "../MentionNode"

/** Run a synchronous callback inside a throw-away Lexical editor context. */
function withEditor<T>(fn: () => T): T {
  const editor = createEditor({ nodes: [MentionNode] })
  let result!: T
  editor.update(
    () => {
      result = fn()
    },
    { discrete: true },
  )
  return result
}

describe("MentionNode", () => {
  it("constructs and exposes its mention data + text", () => {
    withEditor(() => {
      const node = $createMentionNode({ type: "skill", payload: { name: "translate" }, display: "translate" })
      expect($isMentionNode(node)).toBe(true)
      expect(node.getMention().payload.name).toBe("translate")
      expect(node.getTextContent()).toBe("@[skill:translate]")
    })
  })

  it("serializes/deserializes JSON", () => {
    withEditor(() => {
      const node = $createMentionNode({ type: "channel", payload: { id: "cli" }, display: "cli" })
      const json = node.exportJSON()
      const back = MentionNode.importJSON(json)
      expect(back.getMention().payload.id).toBe("cli")
    })
  })
})
