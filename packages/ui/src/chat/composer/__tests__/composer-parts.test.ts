import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { expect, it, vi } from "vitest";
import { MentionNode, $createMentionNode } from "../MentionNode";
import { $readComposerParts } from "../composer-parts";
import { encodeMention } from "../serialize";
import { expandMentionPartsAsync } from "../expandMentions";

it("distinguishes literal token text from actual references while preserving paragraph text", async () => {
  const mention = { type: "dsh.reference", display: "文😀", payload: { source: "files", ref: "id", label: "文😀", clipboardText: "@clip" } };
  const token = encodeMention(mention);
  const editor = createEditor({ nodes: [MentionNode], onError: error => { throw error; } });
  editor.update(() => {
    $getRoot().append($createParagraphNode().append($createTextNode(token)),
      $createParagraphNode().append($createMentionNode(mention), $createTextNode(" tail")));
  }, { discrete: true });
  const parts = editor.getEditorState().read($readComposerParts);
  expect(parts.map(part => part.kind === "text" ? part.text : part.raw).join("")).toBe(editor.getEditorState().read(() => $getRoot().getTextContent()));
  expect(parts[0]).toEqual({ kind: "text", text: token + "\n\n" });
  const resolve = vi.fn(async () => "RESOLVED");
  await expect(expandMentionPartsAsync(parts, [], { serializeReference: resolve })).resolves.toBe(token + "\n\nRESOLVED tail");
  expect(resolve).toHaveBeenCalledTimes(1);
  const reference = parts.find(part => part.kind === "mention");
  if (reference?.kind === "mention") reference.mention.payload.ref = "changed-copy";
  expect(editor.getEditorState().read($readComposerParts)).toContainEqual({ kind: "mention", mention, raw: token });
});
