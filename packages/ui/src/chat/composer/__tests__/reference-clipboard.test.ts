import { $createParagraphNode, $createTextNode, $getRoot, $createRangeSelection, $setSelection, createEditor, COPY_COMMAND, CUT_COMMAND } from "lexical";
import { expect, it, vi } from "vitest";
import { $createMentionNode, MentionNode } from "../MentionNode";
import { $referenceClipboardText, registerReferenceClipboard } from "../reference-clipboard";
import { encodeMention } from "../serialize";

const reference = { type: "dsh.reference", display: "Label", payload: { source: "test", ref: "one", clipboardText: "OWNER_COPY" } };
const token = encodeMention(reference);
function fixture(backward = false) {
  const editor = createEditor({ namespace: "clipboard-test", nodes: [MentionNode], onError: error => { throw error; } });
  const root = document.createElement("div");
  document.body.append(root);
  editor.setRootElement(root);
  const unregister = registerReferenceClipboard(editor);
  const off = () => { unregister(); editor.setRootElement(null); root.remove(); };
  editor.update(() => {
    const p = $createParagraphNode();
    const first = $createTextNode("xx" + token + " ");
    const chip = $createMentionNode(reference);
    const last = $createTextNode(" tail");
    p.append(first, chip, last);
    $getRoot().append(p);
    const selection = $createRangeSelection();
    selection.anchor.set(backward ? last.getKey() : first.getKey(), backward ? 3 : 2, "text");
    selection.focus.set(backward ? first.getKey() : last.getKey(), backward ? 2 : 3, "text");
    $setSelection(selection);
  }, { discrete: true });
  return { editor, off };
}
const event = () => ({ clipboardData: { setData: vi.fn() }, preventDefault: vi.fn() }) as unknown as ClipboardEvent;

it.each([false, true])("copies owner text without changing literal tokens or stored draft, backward=%s", backward => {
  const { editor, off } = fixture(backward);
  const before = editor.getEditorState().read(() => $getRoot().getTextContent());
  const copy = event();
  editor.update(() => { expect(editor.dispatchCommand(COPY_COMMAND, copy)).toBe(true); }, { discrete: true });
  expect(copy.clipboardData!.setData).toHaveBeenCalledWith("text/plain", token + " OWNER_COPY ta");
  expect(copy.preventDefault).toHaveBeenCalledOnce();
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(before);
  off();
});

it("cuts exactly the copied selection", () => {
  const { editor, off } = fixture();
  const cut = event();
  editor.update(() => { editor.dispatchCommand(CUT_COMMAND, cut); }, { discrete: true });
  expect(cut.clipboardData!.setData).toHaveBeenCalledWith("text/plain", token + " OWNER_COPY ta");
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("xxil");
  off();
});

it("keeps multiline boundaries and native mention serialization", () => {
  const { editor, off } = fixture();
  editor.update(() => {
    const root = $getRoot(); root.clear();
    root.append($createParagraphNode().append($createTextNode("first"), $createMentionNode(reference)),
      $createParagraphNode(), $createParagraphNode().append($createMentionNode({ type: "file", display: "File", payload: { path: "a.ts" } })));
    root.select(0, root.getChildrenSize());
    expect($referenceClipboardText()).toBe("firstOWNER_COPY\n\n@[file:a.ts]");
  }, { discrete: true });
  off();
});

it("leaves native-only selections, readonly cuts and unavailable clipboard to existing handlers", () => {
  const { editor, off } = fixture();
  editor.setEditable(false);
  editor.update(() => { expect(editor.dispatchCommand(CUT_COMMAND, event())).toBe(false); }, { discrete: true });
  editor.setEditable(true);
  editor.update(() => {
    expect(editor.dispatchCommand(COPY_COMMAND, null)).toBe(false);
    $getRoot().clear().append($createParagraphNode().append($createTextNode("native")));
    $getRoot().select(0, 1);
    expect(editor.dispatchCommand(COPY_COMMAND, event())).toBe(false);
  }, { discrete: true });
  off();
});
