import { expect, it } from "vitest";
import { composerDraftDocument, decodeComposerDraft, legacyDraftDocument, updateLegacyDraftDocument } from "../composer-draft-document";

const token = "@[dsh.reference:files|id|Label|clip]";
it("migrates v1 references and round-trips v2 literals without reinterpreting their syntax", () => {
  expect(decodeComposerDraft({ version: 1, text: token })?.parts[0].kind).toBe("mention");
  const literal = composerDraftDocument([{ kind: "text", text: token }]);
  expect(decodeComposerDraft(JSON.parse(JSON.stringify({ version: 2, ...literal })))).toEqual(literal);
  expect(Object.isFrozen(literal.parts[0])).toBe(true);
});
it.each([
  { version: 3, text: token, parts: [] },
  { version: 2, text: token, parts: [] },
  { version: 2, text: "x", parts: [{ kind: "text", text: 1 }] },
  { version: 2, text: token, parts: [{ kind: "mention", raw: token, mention: { type: "dsh.reference", display: "Label", payload: { ref: 123 } } }] },
])("ignores malformed or unsupported documents %j", value => {
  expect(decodeComposerDraft(value)).toBeUndefined();
});
it("preserves untouched literals and reference payloads through legacy string edits", () => {
  const reference = legacyDraftDocument(token).parts[0];
  const document = composerDraftDocument([{ kind: "text", text: token + " " }, reference]);
  const appended = updateLegacyDraftDocument(document, document.text + "!");
  expect(appended.parts).toEqual([{ kind: "text", text: token + " " }, reference, { kind: "text", text: "!" }]);
  const changedReference = updateLegacyDraftDocument(document, document.text.slice(0, token.length + 1) + token.replace("|id|", "|new|"));
  expect(changedReference.parts[0]).toEqual(document.parts[0]);
  expect(changedReference.parts[1]).toMatchObject({ kind: "mention", mention: { payload: { ref: "new" } } });
});
