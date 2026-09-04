import { describe, expect, it, vi } from "vitest";

import { createPinState, PIN_SESSION_IDS_KEY } from "./state.js";

/** Minimal in-memory fake of the `StorageAdapter` surface `createPinState` needs. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (keys?: string | string[]) => {
      if (keys === undefined) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of list) out[key] = data[key];
      return out;
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(data, patch);
    }),
    remove: vi.fn(async () => {}),
    watch: vi.fn(() => () => {}),
  };
}

describe("createPinState", () => {
  it("starts with an empty set before load()", () => {
    const state = createPinState(fakeStorage());
    expect(state.isPinned("session-a")).toBe(false);
  });

  it("load() reads the persisted set", async () => {
    const storage = fakeStorage({ [PIN_SESSION_IDS_KEY]: ["session-a", "session-b"] });
    const state = createPinState(storage);
    await state.load();
    expect(state.isPinned("session-a")).toBe(true);
    expect(state.isPinned("session-b")).toBe(true);
    expect(state.isPinned("session-c")).toBe(false);
  });

  it("load() tolerates a missing stored value", async () => {
    const state = createPinState(fakeStorage());
    await state.load();
    expect(state.isPinned("session-a")).toBe(false);
  });

  it("load() tolerates a malformed stored value (not an array)", async () => {
    const storage = fakeStorage({ [PIN_SESSION_IDS_KEY]: "not-an-array" });
    const state = createPinState(storage);
    await state.load();
    expect(state.isPinned("session-a")).toBe(false);
  });

  it("load() drops non-string entries from a malformed array", async () => {
    const storage = fakeStorage({ [PIN_SESSION_IDS_KEY]: ["session-a", 42, null] });
    const state = createPinState(storage);
    await state.load();
    expect(state.isPinned("session-a")).toBe(true);
  });

  it("load() tolerates a rejecting storage.get", async () => {
    const storage = fakeStorage();
    storage.get.mockRejectedValueOnce(new Error("boom"));
    const state = createPinState(storage);
    await expect(state.load()).resolves.toBeUndefined();
    expect(state.isPinned("session-a")).toBe(false);
  });

  it("pin() adds the id, notifies, and persists", async () => {
    const storage = fakeStorage();
    const state = createPinState(storage);
    const listener = vi.fn();
    state.subscribe(listener);
    await state.pin("session-a");
    expect(state.isPinned("session-a")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledWith({ [PIN_SESSION_IDS_KEY]: ["session-a"] });
  });

  it("pin() on an already-pinned id is a no-op", async () => {
    const storage = fakeStorage();
    const state = createPinState(storage);
    await state.pin("session-a");
    const listener = vi.fn();
    state.subscribe(listener);
    await state.pin("session-a");
    expect(listener).not.toHaveBeenCalled();
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  it("unpin() removes the id, notifies, and persists", async () => {
    const storage = fakeStorage();
    const state = createPinState(storage);
    await state.pin("session-a");
    const listener = vi.fn();
    state.subscribe(listener);
    await state.unpin("session-a");
    expect(state.isPinned("session-a")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenLastCalledWith({ [PIN_SESSION_IDS_KEY]: [] });
  });

  it("unpin() on an unpinned id is a no-op", async () => {
    const storage = fakeStorage();
    const state = createPinState(storage);
    const listener = vi.fn();
    state.subscribe(listener);
    await state.unpin("session-a");
    expect(listener).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("subscribe() returns an unsubscribe function", async () => {
    const state = createPinState(fakeStorage());
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);
    unsubscribe();
    await state.pin("session-a");
    expect(listener).not.toHaveBeenCalled();
  });
});
