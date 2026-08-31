import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical"
import { useEffect, useRef } from "react"
import { $createMentionNode } from "../MentionNode"
import { parseTokens } from "../serialize"

/** Two-way sync between Lexical (text + MentionNode) and the canonical value string. */
export function MentionSerializePlugin({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [editor] = useLexicalComposerContext()
  const lastEmitted = useRef<string | null>(null)

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const text = $getRoot().getTextContent() // MentionNode.getTextContent == token
        if (text !== lastEmitted.current) {
          lastEmitted.current = text
          onChange(text)
        }
      })
    })
  }, [editor, onChange])

  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      for (const part of parseTokens(value)) {
        if (part.kind === "text") {
          if (part.text) p.append($createTextNode(part.text))
        } else {
          p.append($createMentionNode(part.mention))
        }
      }
      root.append(p)
      // Programmatic fills (drafts, hand-offs) land with the caret at the
      // END — this branch only runs for external value sets, never for the
      // user's own typing (which updates lastEmitted first).
      p.selectEnd()
    })
  }, [editor, value])

  return null
}
