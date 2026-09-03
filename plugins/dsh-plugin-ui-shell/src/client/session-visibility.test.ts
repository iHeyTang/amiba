import { describe, expect, it, vi } from "vitest";

import { createSessionVisibility } from "./session-visibility.js";

describe("createSessionVisibility", () => {
  it("collects hidden presets, notifies subscribers, and keeps the snapshot stable between changes", () => {
    const visibility = createSessionVisibility();
    const listener = vi.fn();
    visibility.subscribe(listener);
    const before = visibility.source.getSnapshot();
    expect(before.size).toBe(0);
    expect(visibility.source.getSnapshot()).toBe(before);

    const dispose = visibility.hidePreset("amiba-steward");
    expect([...visibility.hiddenPresets()]).toEqual(["amiba-steward"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(visibility.source.getSnapshot()).not.toBe(before);

    dispose();
    expect(visibility.hiddenPresets().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("counts duplicate registrations so one disposer does not unhide another's preset", () => {
    const visibility = createSessionVisibility();
    const a = visibility.hidePreset("x");
    const b = visibility.hidePreset("x");
    a();
    expect(visibility.hiddenPresets().has("x")).toBe(true);
    b();
    expect(visibility.hiddenPresets().has("x")).toBe(false);
  });
});
