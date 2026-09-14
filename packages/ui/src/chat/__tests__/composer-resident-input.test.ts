import { expect, it } from "vitest";
import { createComposerDraftSource } from "../composer-draft-store";

it("projects real references in UTF-16 coordinates without parsing literal tokens", () => {
  const source = createComposerDraftSource();
  source.set("😀 @[dsh.reference:files|one|文档|clip] @[dsh.reference:files|one|文档|clip]");
  const first = source.readInputDraft();
  expect(first.draft).toBe("😀 @文档 @文档");
  expect(first.occurrences.map(item => [item.offset, item.length, item.clipboardText])).toEqual([[3, 3, "clip"], [7, 3, "clip"]]);
  expect(first.occurrences[0].occurrenceId).not.toBe(first.occurrences[1].occurrenceId);
  source.setDisplayText("prefix " + first.draft);
  const moved = source.readInputDraft();
  expect(moved.draftRev).toBeGreaterThan(first.draftRev);
  expect(moved.occurrences.map(item => item.occurrenceId)).toEqual(first.occurrences.map(item => item.occurrenceId));
  expect(moved.occurrences.map(item => item.offset)).toEqual([10, 14]);
  source.setDisplayText(moved.draft + " @[dsh.reference:files|literal|Text|clip]");
  expect(source.readInputDraft().occurrences).toHaveLength(2);
  const stable = source.readInputDraft();
  source.setDisplayText(stable.draft);
  expect(source.readInputDraft()).toBe(stable);
  expect(Object.isFrozen(stable.occurrences[0])).toBe(true);
});

it("observes same-label identity changes and edits away and back between reads", () => {
  const source = createComposerDraftSource();
  source.set("@[dsh.reference:files|one|Label|clip]");
  const first = source.readInputDraft();
  source.set("@[dsh.reference:files|two|Label|clip]");
  const other = source.readInputDraft();
  expect(other.draft).toBe(first.draft);
  expect(other.draftRev).toBeGreaterThan(first.draftRev);
  expect(other.occurrences[0].occurrenceId).not.toBe(first.occurrences[0].occurrenceId);
  source.setDisplayText("");
  source.set("@[dsh.reference:files|two|Label|clip]");
  const recreated = source.readInputDraft();
  expect(recreated.draftRev).toBeGreaterThan(other.draftRev + 1);
  expect(recreated.occurrences[0].occurrenceId).not.toBe(other.occurrences[0].occurrenceId);
  source.setParts([{ kind: "text", text: recreated.draft }]);
  expect(source.readInputDraft()).toMatchObject({ draft: recreated.draft, occurrences: [] });
  expect(source.readInputDraft().draftRev).toBeGreaterThan(recreated.draftRev);
});


it("retains the surviving duplicate reference when structured edits remove the first", () => {
  const source = createComposerDraftSource();
  source.set("@[dsh.reference:files|one|Same|clip] @[dsh.reference:files|one|Same|clip]");
  const before = source.readInputDraft();
  const second = source.getDocument().parts[2];
  source.setParts([second]);
  expect(source.readInputDraft().occurrences[0].occurrenceId).toBe(before.occurrences[1].occurrenceId);
  source.setDisplayText("prefix " + source.readInputDraft().draft);
  expect(source.readInputDraft().occurrences[0].occurrenceId).toBe(before.occurrences[1].occurrenceId);
});


it("keeps independent duplicate IDs through insertion, removal and structured undo", () => {
  const source = createComposerDraftSource();
  source.set("@[dsh.reference:files|one|Same|clip]");
  const original = source.getDocument().parts[0];
  const id = source.readInputDraft().occurrences[0].occurrenceId;
  source.setParts([original, { kind: "text", text: " " }, original]);
  const expanded = source.getDocument();
  const ids = source.readInputDraft().occurrences.map(item => item.occurrenceId);
  expect(ids[0]).toBe(id);
  expect(ids[1]).not.toBe(id);
  expect(expanded.parts[0]).not.toBe(expanded.parts[2]);
  source.setParts([expanded.parts[2]]);
  expect(source.readInputDraft().occurrences[0].occurrenceId).toBe(ids[1]);
  source.setParts(expanded.parts);
  expect(source.readInputDraft().occurrences.map(item => item.occurrenceId)).toEqual(ids);
});
