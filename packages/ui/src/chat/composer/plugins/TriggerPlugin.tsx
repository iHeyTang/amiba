import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getSelection, $isRangeSelection } from "lexical"
import { useEffect } from "react"

export interface TriggerState {
  trigger: "/" | "@"
  query: string
  start: number // index of the trigger char within the current text run
}

/** Pure detector: given the text before the caret, find an open trigger.
 *  Slash is line-anchored and its query spans the whole line (so multi-word
 *  subcommands like "/reasoning low" keep the menu open). @ stops at whitespace. */
export function detectTrigger(textToCaret: string, _caret: number): TriggerState | null {
  const slashLine = /^\/([^\n]*)$/.exec(textToCaret)
  if (slashLine) {
    return { trigger: "/", query: slashLine[1], start: 0 }
  }
  const m = /(^|\s)(@)([^\s]*)$/.exec(textToCaret)
  if (!m) return null
  const query = m[3]
  const start = textToCaret.length - query.length - 1
  return { trigger: "@", query, start }
}

export function TriggerPlugin({ onTrigger }: { onTrigger: (s: TriggerState | null) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection()
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) { onTrigger(null); return }
        const node = sel.anchor.getNode()
        const offset = sel.anchor.offset
        const textToCaret = node.getTextContent().slice(0, offset)
        onTrigger(detectTrigger(textToCaret, offset))
      })
    })
  }, [editor, onTrigger])
  return null
}
