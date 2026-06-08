import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  INSERT_LINE_BREAK_COMMAND,
  KEY_ENTER_COMMAND,
} from "lexical"
import { useEffect } from "react"

/**
 * Mirror the old textarea key logic:
 * - IME composing (isComposing / key==="Process") -> let Lexical handle, never submit
 * - Enter / Cmd+Enter / Ctrl+Enter (no Shift, no Alt) -> submit
 * - Shift+Enter -> newline
 */
export function ImeEnterPlugin({
  onSubmitChord,
  onKeyDownExtra,
}: {
  onSubmitChord: () => void
  onKeyDownExtra?: (e: KeyboardEvent) => boolean | void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_ENTER_COMMAND,
      (e) => {
        if (!e) return false
        if (onKeyDownExtra) {
          const swallow = onKeyDownExtra(e)
          if (swallow === true) return true
          if (e.defaultPrevented) return true
        }
        const ne = e as KeyboardEvent & { isComposing?: boolean }
        if (ne.isComposing || e.key === "Process") return false
        const isSendChord =
          (e.metaKey || e.ctrlKey) || (!e.shiftKey && !e.altKey)
        if (!isSendChord) {
          // Shift+Enter or Alt+Enter -> newline
          e.preventDefault()
          editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false)
          return true
        }
        e.preventDefault()
        onSubmitChord()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, onSubmitChord, onKeyDownExtra])
  return null
}
