import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $createRangeSelection, $getRoot, $getSelection, $isRangeSelection, $setSelection } from "lexical"
import { useImperativeHandle, type Ref } from "react"

import { $caretOffset, $scanDraft, $spliceTriggerText } from "../triggers/lexical-draft"
import { detectTrigger } from "../triggers/detect"

export interface RichComposerHandle {
  openMention(): void
  consumeMentionTrigger(): void
  focus(): void
  select(): void
  getTextarea(): HTMLTextAreaElement | null
}

export function ImperativeHandlePlugin({ handleRef }: { handleRef: Ref<RichComposerHandle> }) {
  const [editor] = useLexicalComposerContext()
  useImperativeHandle(
    handleRef,
    (): RichComposerHandle => ({
      focus: () => editor.focus(),
      openMention: () => {
        if (!editor.isEditable()) return
        editor.update(() => {
          let selection = $getSelection()
          if (!$isRangeSelection(selection)) selection = $getRoot().selectEnd()
          if (!$isRangeSelection(selection)) return
          // Preserve selected draft text: insert at its end, never replace it.
          selection.anchor.set(selection.focus.key, selection.focus.offset, selection.focus.type)
          const scan = $scanDraft()
          const caret = $caretOffset(scan) ?? scan.draft.length
          const hit = detectTrigger(scan.draft, caret, { tier: "plain" })
          if (hit?.trigger === "@") {
            selection.dirty = true
            return
          }
          const prefix = caret > 0 && /[\p{L}\p{N}_]/u.test(scan.draft[caret - 1]) ? " " : ""
          selection.insertText(`${prefix}@`)
        })
      },
      consumeMentionTrigger: () => {
        editor.update(() => {
          const scan = $scanDraft()
          const caret = $caretOffset(scan)
          if (caret === null) return
          const hit = detectTrigger(scan.draft, caret, { tier: "plain" })
          if (hit?.trigger === "@") $spliceTriggerText(hit.span.start, hit.span.end, "")
        })
      },
      select: () =>
        editor.update(() => {
          const root = $getRoot()
          const sel = $createRangeSelection()
          sel.anchor.set(root.getKey(), 0, "element")
          sel.focus.set(root.getKey(), root.getChildrenSize(), "element")
          $setSelection(sel)
        }),
      // No native textarea anymore; production code never calls this.
      getTextarea: () => null,
    }),
    [editor],
  )
  return null
}
