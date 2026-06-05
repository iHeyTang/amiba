import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical"
import { useEffect, useRef } from "react"

/**
 * Two-way sync between Lexical state and a plain-text `value` string.
 * Phase 2: plain text only. Mention serialization is layered on in Part 3
 * (this plugin will be replaced by MentionSerializePlugin there).
 */
export function ValueSyncPlugin({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [editor] = useLexicalComposerContext()
  const lastEmitted = useRef<string | null>(null)

  // editor -> value
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const text = $getRoot().getTextContent()
        if (text !== lastEmitted.current) {
          lastEmitted.current = text
          onChange(text)
        }
      })
    })
  }, [editor, onChange])

  // value -> editor (only when external value diverges from what we emitted)
  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      if (value) p.append($createTextNode(value))
      root.append(p)
    })
  }, [editor, value])

  return null
}
