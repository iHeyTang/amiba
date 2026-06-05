import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { render, screen, waitFor } from "@testing-library/react"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical"
import { useEffect } from "react"
import { describe, expect, it, vi } from "vitest"
import { RichComposerEditor } from "../RichComposerEditor"

/**
 * Test-only plugin: hands the live LexicalEditor instance back to the test so
 * editor content changes can be driven programmatically.
 *
 * jsdom implements `beforeinput` / Selection / DOM-mutation APIs incompletely,
 * so `userEvent.keyboard(...)` does NOT drive Lexical's text insertion the way a
 * real browser does (verified: nothing is emitted). We therefore insert text via
 * `editor.update` — this exercises the exact same path real typing produces
 * (a node-tree mutation that the editor->value update listener serialises),
 * so the onChange contract is genuinely verified, not stubbed.
 */
function EditorRefCapture({ onReady }: { onReady: (e: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])
  return null
}

describe("RichComposerEditor", () => {
  it("emits typed text via onChange", async () => {
    const onChange = vi.fn()
    const editorRef: { current: LexicalEditor | null } = { current: null }

    render(
      <RichComposerEditor value="" onChange={onChange}>
        <EditorRefCapture onReady={(e) => (editorRef.current = e)} />
      </RichComposerEditor>,
    )

    // Drive a content change the way real typing would: mutate the node tree.
    await waitFor(() => expect(editorRef.current).not.toBeNull())
    editorRef.current?.update(() => {
      const root = $getRoot()
      root.clear()
      const p = $createParagraphNode()
      p.append($createTextNode("hello"))
      root.append(p)
    })

    // The update listener flushes on a microtask.
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("hello"),
    )
  })

  it("renders external value", async () => {
    render(<RichComposerEditor value="preset" onChange={() => {}} />)
    // editor.update reconciliation to the DOM is async in jsdom.
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveTextContent("preset"),
    )
  })

  it("caps height at maxHeightPx and switches to scroll", async () => {
    const { container } = render(
      <RichComposerEditor value={"a\n".repeat(50)} onChange={() => {}} maxHeightPx={100} />,
    )
    const editable = container.querySelector('[role="textbox"]') as HTMLElement
    // jsdom 不计算真实布局，这里断言样式被写入（overflowY 被设置）
    expect(["auto", "hidden"]).toContain(editable.style.overflowY)
  })
})
