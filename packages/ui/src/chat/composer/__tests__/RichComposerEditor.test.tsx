import { createComposerDraftSource } from "../../composer-draft-store"
import { $isElementNode } from "lexical"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { render, screen, waitFor } from "@testing-library/react"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  KEY_ENTER_COMMAND,
  UNDO_COMMAND, REDO_COMMAND,
  type LexicalEditor,
} from "lexical"
import { useEffect, useLayoutEffect, createRef, act } from "react"
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
  it("updates read-only state without replacing the editor or losing its draft", async () => {
    const capture = vi.fn();
    const onChange = vi.fn();
    const content = <EditorRefCapture onReady={capture} />;
    const { rerender } = render(<RichComposerEditor value="Kept draft" onChange={onChange}>{content}</RichComposerEditor>);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveTextContent("Kept draft"));
    const node = screen.getByRole("textbox");
    const editor = capture.mock.calls[0][0] as LexicalEditor;
    rerender(<RichComposerEditor value="Kept draft" disabled onChange={onChange}>{content}</RichComposerEditor>);
    expect(editor.isEditable()).toBe(false);
    expect(node).toHaveAttribute("contenteditable", "false");
    rerender(<RichComposerEditor value="Kept draft" onChange={onChange}>{content}</RichComposerEditor>);
    expect(editor.isEditable()).toBe(true);
    expect(screen.getByRole("textbox")).toBe(node);
    expect(node).toHaveTextContent("Kept draft");
    expect(capture).toHaveBeenCalledTimes(1);
  });

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


it("switches identical canonical strings without confusing literal text with a reference", async () => {
  const literal = createComposerDraftSource(), reference = createComposerDraftSource();
  const token = "@[dsh.reference:files|id|Label|clip]";
  literal.setParts([{ kind: "text", text: token }]);
  reference.set(token);
  const ref = createRef<RichComposerHandle>();
  const { rerender } = render(<RichComposerEditor ref={ref} value={token} draftSource={literal} onChange={literal.set} />);
  await waitFor(() => expect(ref.current?.getParts?.()).toEqual([{ kind: "text", text: token }]));
  const editor = screen.getByRole("textbox");
  rerender(<RichComposerEditor ref={ref} value={token} draftSource={reference} onChange={reference.set} />);
  await waitFor(() => expect(ref.current?.getParts?.()[0].kind).toBe("mention"));
  expect(screen.getByRole("textbox")).toBe(editor);
  rerender(<RichComposerEditor ref={ref} value={token} draftSource={literal} onChange={literal.set} />);
  await waitFor(() => expect(ref.current?.getParts?.()).toEqual([{ kind: "text", text: token }]));
  expect(screen.getByRole("textbox")).toBe(editor);
});


it("restores a session history on a new editor without retaining the old editor target", async () => {
  const source = createComposerDraftSource(); source.set("one");
  let editor!: LexicalEditor;
  const view = () => <RichComposerEditor value={source.getSnapshot()} draftSource={source} onChange={source.set}><EditorRefCapture onReady={next => { editor = next; }} /></RichComposerEditor>;
  const first = render(view());
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("one"));
  act(() => editor.update(() => { $getRoot().clear().append($createParagraphNode().append($createTextNode("two"))); }, { discrete: true, tag: "history-push" }));
  await waitFor(() => expect(source.getSnapshot()).toBe("two"));
  const oldEditor = editor;
  first.unmount();
  render(view());
  await waitFor(() => expect(editor).not.toBe(oldEditor));
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("two"));
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getSnapshot()).toBe("one"));
  act(() => { editor.dispatchCommand(REDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getSnapshot()).toBe("two"));
});

it.each([true, false])("retains reference redo history across session changes (remount=%s)", async remount => {
  const source = createComposerDraftSource(), other = createComposerDraftSource();
  source.set("@[dsh.reference:files|id|Label|clip|file]");
  const original = source.getDocument();
  let editor!: LexicalEditor;
  const view = (draft = source) => <RichComposerEditor key={remount ? (draft === source ? "a" : "b") : undefined}
    value={draft.getSnapshot()} draftSource={draft} onChange={draft.set}>
    <EditorRefCapture onReady={next => { editor = next; }} />
  </RichComposerEditor>;
  const mounted = render(view());
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(original.text));
  const nodeKeys = () => editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    return $isElementNode(paragraph) ? paragraph.getChildrenKeys() : [];
  });
  const keys = nodeKeys();
  act(() => editor.update(() => { $getRoot().clear().append($createParagraphNode()); }, { discrete: true, tag: "history-push" }));
  await waitFor(() => expect(source.getSnapshot()).toBe(""));
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getDocument()).toEqual(original));
  mounted.rerender(view(other));
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(""));
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  expect(other.getSnapshot()).toBe("");
  expect(source.getDocument()).toEqual(original);
  mounted.rerender(view());
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(original.text));
  act(() => { editor.dispatchCommand(REDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getSnapshot()).toBe(""));
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getDocument()).toEqual(original));
  expect(nodeKeys()).toEqual(keys);
});

it("does not restore a stale history over an offscreen draft edit", async () => {
  const source = createComposerDraftSource(); source.set("one");
  let editor!: LexicalEditor;
  const view = () => <RichComposerEditor value={source.getSnapshot()} draftSource={source} onChange={source.set}><EditorRefCapture onReady={next => { editor = next; }} /></RichComposerEditor>;
  const first = render(view());
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("one"));
  act(() => editor.update(() => { $getRoot().clear().append($createParagraphNode().append($createTextNode("two"))); }, { discrete: true, tag: "history-push" }));
  await waitFor(() => expect(source.getSnapshot()).toBe("two"));
  first.unmount();
  source.setDisplayText("external");
  render(view());
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("external"));
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getSnapshot()).toBe("external"));
});

it.each(["incoming", ""])("keeps a draft update arriving while cached history restoration is queued: %j", async incomingText => {
  const source = createComposerDraftSource(); source.set("before");
  let editor!: LexicalEditor;
  function IncomingDraft({ enabled }: { enabled: boolean }) {
    useLayoutEffect(() => { if (enabled) source.setDisplayText(incomingText); }, [enabled]);
    return null;
  }
  const view = (incoming = false) => <RichComposerEditor value={source.getSnapshot()} draftSource={source} onChange={source.set}>
    <EditorRefCapture onReady={next => { editor = next; }} />
    <IncomingDraft enabled={incoming} />
  </RichComposerEditor>;
  const first = render(view());
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("before"));
  act(() => editor.update(() => { $getRoot().clear().append($createParagraphNode().append($createTextNode("cached"))); }, { discrete: true, tag: "history-push" }));
  await waitFor(() => expect(source.getSnapshot()).toBe("cached"));
  first.unmount();
  render(view(true));
  await waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(incomingText));
  expect(source.getSnapshot()).toBe(incomingText);
  act(() => { editor.dispatchCommand(UNDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getSnapshot()).toBe(incomingText));
  act(() => { editor.dispatchCommand(REDO_COMMAND, undefined); });
  await waitFor(() => expect(source.getSnapshot()).toBe(incomingText));
});
