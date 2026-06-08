import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $createRangeSelection, $getRoot, $setSelection } from "lexical"
import { useImperativeHandle, type Ref } from "react"

export interface RichComposerHandle {
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
