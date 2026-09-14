import { consumeRestoredDocument } from "./ComposerHistoryPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { $createMentionNode } from "../MentionNode"
import { parseTokens } from "../serialize"
import { $readComposerParts } from "../composer-parts"
import type { ComposerDraftSource } from "../../composer-draft-store"
import type { ComposerDraftDocument } from "../../composer-draft-document"

const noSubscribe = () => () => {}
const noDocument = () => undefined
const RESTORE_TAG = "amiba-composer-document-restore"

/** Native documents own node identity; older embedders retain string synchronization. */
export function MentionSerializePlugin({ value, onChange, draftSource }: {
  value: string
  onChange: (next: string) => void
  draftSource?: ComposerDraftSource
}) {
  const [editor] = useLexicalComposerContext()
  const document = useSyncExternalStore(draftSource?.subscribe ?? noSubscribe,
    draftSource?.getDocument ?? noDocument, draftSource?.getDocument ?? noDocument)
  const lastEmitted = useRef<string | null>(null)
  const lastDocument = useRef<ComposerDraftDocument | undefined>()
  const lastSource = useRef<ComposerDraftSource | undefined>()

  useEffect(() => editor.registerUpdateListener(({ editorState, tags }) => {
    if (tags.has(RESTORE_TAG)) return
    editorState.read(() => {
      const text = $getRoot().getTextContent()
      if (draftSource) {
        draftSource.setParts($readComposerParts())
        lastSource.current = draftSource
        lastDocument.current = draftSource.getDocument()
      }
      if (text !== lastEmitted.current) {
        lastEmitted.current = text
        onChange(text)
      }
    })
  }), [editor, onChange, draftSource])

  useEffect(() => {
    if (draftSource && document) {
      if (lastSource.current === draftSource && lastDocument.current === document) return
    } else if (!lastSource.current && value === lastEmitted.current) return
    lastSource.current = draftSource
    lastDocument.current = document
    lastEmitted.current = document?.text ?? value
    if (document && consumeRestoredDocument(editor, document)) return
    const parts = document?.parts ?? parseTokens(value)
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      for (const part of parts) {
        if (part.kind === "text") {
          if (part.text) p.append($createTextNode(part.text))
        } else p.append($createMentionNode({ ...part.mention, payload: { ...part.mention.payload } }))
      }
      root.append(p)
      p.selectEnd()
    }, { tag: RESTORE_TAG })
  }, [editor, value, document, draftSource])
  return null
}
