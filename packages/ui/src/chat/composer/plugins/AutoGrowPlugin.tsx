import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLayoutEffect } from "react"

/** Mirror the old textarea auto-grow: grow to content, cap at maxHeightPx, then scroll. */
export function AutoGrowPlugin({ maxHeightPx }: { maxHeightPx: number }) {
  const [editor] = useLexicalComposerContext()
  useLayoutEffect(() => {
    const apply = () => {
      const el = editor.getRootElement()
      if (!el) return
      el.style.height = "auto"
      const sh = el.scrollHeight
      el.style.height = `${Math.min(sh, maxHeightPx)}px`
      el.style.overflowY = sh > maxHeightPx ? "auto" : "hidden"
    }
    apply()
    return editor.registerUpdateListener(() => apply())
  }, [editor, maxHeightPx])
  return null
}
