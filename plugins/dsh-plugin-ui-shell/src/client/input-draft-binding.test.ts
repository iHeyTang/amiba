import { expect, it, vi } from "vitest";
import type { TriggerEditorOps } from "@amiba/ui";
import { bindInputDraft } from "./input-draft-binding.js";

type Draft = ReturnType<NonNullable<TriggerEditorOps["readInputDraft"]>>;
it("keeps revision and occurrence identity across status-only changes, but observes skipped edits", () => {
  const occurrence = { occurrenceId: 1, source: "files", ref: "one", label: "One", clipboardText: "@one", offset: 0, length: 4 };
  let value: Draft = { draft: "@One", draftRev: 0, occurrences: [occurrence], phase: "plain" };
  const write = vi.fn(() => true);
  const binding = bindInputDraft({ readInputDraft: () => value, setInputDraft: write } as unknown as TriggerEditorOps,
    { revision: 20, occurrence: 30 });
  const first = binding.read()!;
  expect(first.draftRev).toBe(21);
  expect(first.occurrences[0].occurrenceId).toBe(31);
  expect(binding.read()).toBe(first);
  value = { ...value, phase: "submitting" };
  const submitting = binding.read()!;
  expect(submitting.phase).toBe("submitting");
  expect(submitting.draftRev).toBe(first.draftRev);
  expect(submitting.occurrences).toEqual(first.occurrences);
  value = { ...value, draftRev: 4 }; // User edited away and back between public reads.
  expect(binding.read()!.draftRev).toBe(25);
  expect(binding.write("old", first.draftRev)).toBe(false);
  expect(write).not.toHaveBeenCalled();
  expect(binding.write("new", 25)).toBe(true);
  expect(write).toHaveBeenCalledWith("new", 4);
});

it("refuses a guarded write without a readable state", () => {
  const write = vi.fn(() => true);
  const binding = bindInputDraft({ setInputDraft: write } as unknown as TriggerEditorOps, { revision: -1, occurrence: 0 });
  expect(binding.write("guarded", 0)).toBe(false);
  expect(write).not.toHaveBeenCalled();
  expect(binding.write("unguarded")).toBe(true);
});
