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


it("preserves unchanged duplicate reference identities across editor and resident handoff", () => {
  const cursor = { revision: -1, occurrence: 0 };
  const occurrence = { source: "files", ref: "one", label: "One", clipboardText: "@one", length: 4 };
  const draft = (first: number): Draft => ({ draft: "@One @One", draftRev: 0, phase: "plain", occurrences: [
    { ...occurrence, occurrenceId: first, offset: 0 },
    { ...occurrence, occurrenceId: first + 1, offset: 5 },
  ] });
  const bind = (value: Draft) => bindInputDraft({ readInputDraft: () => value } as unknown as TriggerEditorOps, cursor);
  const mounted = bind(draft(9)).read()!;
  const resident = bind(draft(1)).read()!;
  const restored = bind(draft(100)).read()!;
  expect(resident.occurrences).toEqual(mounted.occurrences);
  expect(restored.occurrences).toEqual(mounted.occurrences);
  expect(new Set(restored.occurrences.map(item => item.occurrenceId)).size).toBe(2);
  expect(resident.draftRev).toBeGreaterThan(mounted.draftRev);
  expect(restored.draftRev).toBeGreaterThan(resident.draftRev);
});


it("does not reuse identity for a recreated chip within a live binding", () => {
  const occurrence = { occurrenceId: 1, source: "files", ref: "one", label: "One", clipboardText: "@one", offset: 0, length: 4 };
  let value: Draft = { draft: "@One", draftRev: 0, occurrences: [occurrence], phase: "plain" };
  const binding = bindInputDraft({ readInputDraft: () => value } as unknown as TriggerEditorOps, { revision: -1, occurrence: 0 });
  const first = binding.read()!;
  value = { ...value, draftRev: 2, occurrences: [{ ...occurrence, occurrenceId: 2 }] };
  expect(binding.read()!.occurrences[0].occurrenceId).not.toBe(first.occurrences[0].occurrenceId);
});

it.each(["source", "ref", "label", "clipboardText"] as const)("does not transfer changed %s at handoff", field => {
  const cursor = { revision: -1, occurrence: 0 };
  const occurrence = { occurrenceId: 1, source: "files", ref: "one", label: "One", clipboardText: "@one", offset: 0, length: 4 };
  const value: Draft = { draft: "@One", draftRev: 0, occurrences: [occurrence], phase: "plain" };
  const first = bindInputDraft({ readInputDraft: () => value } as unknown as TriggerEditorOps, cursor).read()!;
  const changed = { ...value, occurrences: [{ ...occurrence, [field]: "changed" }] };
  const next = bindInputDraft({ readInputDraft: () => changed } as unknown as TriggerEditorOps, cursor).read()!;
  expect(next.occurrences[0].occurrenceId).not.toBe(first.occurrences[0].occurrenceId);
});
