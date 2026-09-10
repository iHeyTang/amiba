import { describe, expect, it, vi } from "vitest";

import { createSessionVisibility } from "./session-visibility.js";

describe("createSessionVisibility", () => {
  it("collects owned session IDs, notifies subscribers, and keeps the snapshot stable between changes", () => {
    const visibility = createSessionVisibility();
    const listener = vi.fn();
    visibility.subscribe(listener);
    const before = visibility.source.getSnapshot();
    expect(before.size).toBe(0);
    expect(visibility.source.getSnapshot()).toBe(before);

    const dispose = visibility.hideSession("session-steward");
    expect([...visibility.hiddenSessions()]).toEqual(["session-steward"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(visibility.source.getSnapshot()).not.toBe(before);

    dispose();
    expect(visibility.hiddenSessions().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("counts duplicate registrations so one disposer does not unhide another's session", () => {
    const visibility = createSessionVisibility();
    const a = visibility.hideSession("x");
    const b = visibility.hideSession("x");
    a();
    expect(visibility.hiddenSessions().has("x")).toBe(true);
    b();
    expect(visibility.hiddenSessions().has("x")).toBe(false);
  });
});
