// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createConversationViewSource } from "./conversation-view-source.js";

it("projects ordered metadata without invoking session inject and disposes subscriptions", () => {
  document.documentElement.lang = "en";
  const inject = vi.fn(() => {
    throw new Error("Requires a real session context");
  });
  let version = 1;
  const unsubscribe = vi.fn();
  let changed: () => void = () => {};
  let entries = [
    {
      options: {
        id: "b",
        order: 2,
        label: () => (document.documentElement.lang === "en" ? "B" : "乙"),
      },
      inject,
    },
    { options: { id: "a", order: 1 }, inject },
  ];
  const source = createConversationViewSource({
    entriesOfSlot: () => entries,
    getVersion: () => version,
    subscribe: (_name, listener) => {
      changed = listener;
      return unsubscribe;
    },
  });
  const listener = vi.fn();
  const off = source.subscribe(listener);
  const first = source.getSnapshot();
  expect(first).toEqual([
    { id: "a", label: "a" },
    { id: "b", label: "B" },
  ]);
  expect(source.getSnapshot()).toBe(first);
  expect(inject).not.toHaveBeenCalled();
  document.documentElement.lang = "zh-CN";
  expect(source.getSnapshot()[1]?.label).toBe("乙");
  entries = [];
  version++;
  changed();
  expect(listener).toHaveBeenCalled();
  expect(source.getSnapshot()).toEqual([]);
  off();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(inject).not.toHaveBeenCalled();
});
