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

/**
 * Like `fakeStorage`, but `get()` doesn't resolve on its own — each call
 * snapshots `data` synchronously (mirroring a real storage read that
 * captures state at request time, not at response time) and queues a
 * resolver; the test drives responses one at a time with
 * `resolveNextGet()`. Lets a test land a `pin()`/`unpin()` — and its own
 * synchronous `storage.set()` — while a `load()`'s read is still pending,
 * to exercise `state.ts`'s racing-mutation merge.
 */
function deferredStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const pending: Array<() => void> = [];
  const get = vi.fn((keys?: string | string[]) => {
    const snapshot = { ...data };
    return new Promise<Record<string, unknown>>((resolve) => {
      pending.push(() => {
        if (keys === undefined) {
          resolve(snapshot);
          return;
        }
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const key of list) out[key] = snapshot[key];
        resolve(out);
      });
    });
  });
  return {
    data,
    resolveNextGet: () => {
      const next = pending.shift();
      next?.();
    },
    get,
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

  describe("racing pin()/unpin() against an in-flight load()", () => {
    it("pin() during an in-flight load() survives and merges with the loaded ids", async () => {
      const storage = deferredStorage({ [PIN_SESSION_IDS_KEY]: ["session-a"] });
      const state = createPinState(storage);

      const loadPromise = state.load();
      // Lands while the read above is still pending — `index.tsx` wires the
      // interactive faces right after firing `load()`, so this is the
      // exact window the fix closes.
      await state.pin("session-b");
      storage.resolveNextGet();
      await loadPromise;

      expect(state.isPinned("session-a")).toBe(true);
      expect(state.isPinned("session-b")).toBe(true);
      expect(new Set(storage.data[PIN_SESSION_IDS_KEY] as string[])).toEqual(
        new Set(["session-a", "session-b"]),
      );
    });

    it("unpin() during an in-flight load() removes an id also present in the loaded set", async () => {
      const storage = deferredStorage({ [PIN_SESSION_IDS_KEY]: ["session-a", "session-b"] });
      const state = createPinState(storage);

      // Prime in-memory state to match storage with a first, uncontested load.
      const firstLoad = state.load();
      storage.resolveNextGet();
      await firstLoad;
      expect(state.isPinned("session-a")).toBe(true);

      const secondLoad = state.load();
      await state.unpin("session-a"); // races the second load's read
      storage.resolveNextGet();
      await secondLoad;

      expect(state.isPinned("session-a")).toBe(false);
      expect(state.isPinned("session-b")).toBe(true);
      expect(storage.data[PIN_SESSION_IDS_KEY]).not.toContain("session-a");
    });

    it("does not persist again when load() finishes with no racing mutation", async () => {
      const storage = deferredStorage({ [PIN_SESSION_IDS_KEY]: ["session-a"] });
      const state = createPinState(storage);

      const loadPromise = state.load();
      storage.resolveNextGet();
      await loadPromise;

      expect(state.isPinned("session-a")).toBe(true);
      expect(storage.set).not.toHaveBeenCalled();
    });
  });
});
