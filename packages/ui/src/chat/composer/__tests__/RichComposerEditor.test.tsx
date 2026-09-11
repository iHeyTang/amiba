import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { render, screen, waitFor } from "@testing-library/react"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical"
import { useEffect, createRef, act } from "react"
import { describe, expect, it, vi } from "vitest"
import { RichComposerEditor, type RichComposerHandle } from "../RichComposerEditor"

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
  it("opens mentions at the caret without replacing selected text or duplicating an active @", async () => {
    Range.prototype.getBoundingClientRect ??= () => new DOMRect()
    const ref = createRef<RichComposerHandle>()
    const editorRef: { current: LexicalEditor | null } = { current: null }
    const onChange = vi.fn()
    render(<RichComposerEditor ref={ref} value="" onChange={onChange}>
      <EditorRefCapture onReady={editor => { editorRef.current = editor }} />
    </RichComposerEditor>)
    await act(async () => {
      editorRef.current!.update(() => {
        const root = $getRoot()
        root.clear()
        const text = $createTextNode("hello world")
        root.append($createParagraphNode().append(text))
        text.select(0, 5)
      })
    })
    await act(async () => { ref.current!.openMention() })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("hello @ world"))
    await act(async () => { ref.current!.openMention() })
    expect(screen.getByRole("textbox").textContent).toBe("hello @ world")
    // jsdom's DOM selectionchange may reset a no-text-change selection.
    // Supply the caret exactly as the browser does before consuming the token.
    await act(async () => {
      editorRef.current!.update(() => {
        const text = $getRoot().getAllTextNodes()[0]
        if ($isTextNode(text)) text.select(7, 7)
      }, { discrete: true })
      ref.current!.consumeMentionTrigger()
    })
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("hello world"))
  })

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

  it("remeasures when layout classes change without an editor update", () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("density-default") ? 60 : 48
      })

    try {
      const { container, rerender } = render(
        <RichComposerEditor
          value=""
          onChange={() => {}}
          className="density-compact"
        />,
      )
      const editable = container.querySelector(
        '[role="textbox"]',
      ) as HTMLElement
      expect(editable.style.height).toBe("48px")
      expect(editable.dataset.autoGrowTargetHeight).toBe("48")

      rerender(
        <RichComposerEditor
          value=""
          onChange={() => {}}
          className="density-default"
        />,
      )
      expect(editable.style.height).toBe("60px")
      expect(editable.dataset.autoGrowTargetHeight).toBe("60")
    } finally {
      scrollHeight.mockRestore()
    }
  })

  it("Enter submits, Shift+Enter inserts newline, IME-composing Enter does not submit", async () => {
    const onSubmit = vi.fn()
    const editorRef: { current: LexicalEditor | null } = { current: null }

    render(
      <RichComposerEditor value="" onChange={() => {}} onSubmitChord={onSubmit}>
        <EditorRefCapture onReady={(e) => (editorRef.current = e)} />
      </RichComposerEditor>,
    )

    await waitFor(() => expect(editorRef.current).not.toBeNull())
    const editor = editorRef.current!

    // jsdom does not wire real DOM keydown events into Lexical's KEY_ENTER_COMMAND,
    // so we dispatch the command directly with a synthetic KeyboardEvent.

    // plain Enter -> submit
    const enterEvt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    editor.dispatchCommand(KEY_ENTER_COMMAND, enterEvt)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // Shift+Enter -> newline, no additional submit
    const shiftEnterEvt = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
    editor.dispatchCommand(KEY_ENTER_COMMAND, shiftEnterEvt)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // IME-composing Enter (key="Process") -> no submit
    const imeEvt = new KeyboardEvent("keydown", { key: "Process", bubbles: true })
    editor.dispatchCommand(KEY_ENTER_COMMAND, imeEvt)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // IME-composing Enter via isComposing flag -> no submit
    const imeEvt2 = new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    Object.defineProperty(imeEvt2, "isComposing", { value: true })
    editor.dispatchCommand(KEY_ENTER_COMMAND, imeEvt2)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("exposes focus() imperative handle", async () => {
    const ref = { current: null as null | { focus(): void; select(): void; getTextarea(): unknown } }
    render(<RichComposerEditor ref={ref as never} value="" onChange={() => {}} />)
    expect(typeof ref.current?.focus).toBe("function")
    expect(ref.current?.getTextarea()).toBeNull()
  })
})
