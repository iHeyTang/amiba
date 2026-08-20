import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useEffect } from "react"
import { detectTrigger, type TriggerHit } from "../triggers/detect"
import { $caretOffset, $scanDraft } from "../triggers/lexical-draft"
import type { ComposerTriggerSession } from "../triggers/session"

/**
 * A live trigger token, in TRIGGER-DRAFT coordinates (chips count as one
 * U+FFFC each — see `triggers/lexical-draft.ts`). Identical in shape and
 * meaning to the official `TriggerHit`, so a pick routed through this state
 * carries the same `TokenSpan` an in-session pick does.
 */
export type TriggerState = TriggerHit

export { detectTrigger }

/**
 * Surface-local detection for composers with no official controller (home /
 * draft composer, Quick-Ask, the browser extension). The in-session composer
 * does NOT mount this: there `InputTriggerController.track` runs the real
 * upstream detector.
 */
export function TriggerPlugin({
  onTrigger,
  trigger,
}: {
  onTrigger: (s: TriggerState | null) => void
  trigger: ComposerTriggerSession
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    let lastDraft: string | null = null
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const scan = $scanDraft()
        const caret = $caretOffset(scan)
        if (scan.draft !== lastDraft) {
          lastDraft = scan.draft
          trigger.revision.bump()
          trigger.claims.watch(scan.draft)
        }
        if (caret === null) {
          onTrigger(null)
          return
        }
        onTrigger(
          detectTrigger(scan.draft, caret, trigger.guard(), trigger.revision.value),
        )
      })
    })
  }, [editor, onTrigger, trigger])
  return null
}
