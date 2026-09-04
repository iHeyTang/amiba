import { describe, expect, it, vi } from "vitest";

import { pinMenuFace, pinnedGroupFace, unpinMenuFace } from "./faces.js";
import { createPinState } from "./state.js";

/** Minimal in-memory fake of the `StorageAdapter` surface `createPinState` needs. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
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

const session = (id: string) => ({ id, title: id });

describe("pinMenuFace", () => {
  it("is visible for an unpinned session and hidden once pinned", async () => {
    const state = createPinState(fakeStorage());
    const face = pinMenuFace(state);
    expect(face.visible?.(session("session-a"))).toBe(true);
    await state.pin("session-a");
    expect(face.visible?.(session("session-a"))).toBe(false);
  });

  it("run() pins the session", async () => {
    const state = createPinState(fakeStorage());
    const face = pinMenuFace(state);
    await face.run(session("session-a"));
    expect(state.isPinned("session-a")).toBe(true);
  });

  it("subscribe forwards to the state's subscribe", () => {
    const state = createPinState(fakeStorage());
    const face = pinMenuFace(state);
    expect(face.subscribe).toBe(state.subscribe);
  });
});

describe("unpinMenuFace", () => {
  it("is hidden for an unpinned session and visible once pinned", async () => {
    const state = createPinState(fakeStorage());
    const face = unpinMenuFace(state);
    expect(face.visible?.(session("session-a"))).toBe(false);
    await state.pin("session-a");
    expect(face.visible?.(session("session-a"))).toBe(true);
  });

  it("run() unpins the session", async () => {
    const state = createPinState(fakeStorage());
    await state.pin("session-a");
    const face = unpinMenuFace(state);
    await face.run(session("session-a"));
    expect(state.isPinned("session-a")).toBe(false);
  });
});

describe("pinMenuFace and unpinMenuFace", () => {
  it("are mutually exclusive for any given session", async () => {
    const state = createPinState(fakeStorage());
    const pinFace = pinMenuFace(state);
    const unpinFace = unpinMenuFace(state);
    const target = session("session-a");
    expect(pinFace.visible?.(target)).not.toBe(unpinFace.visible?.(target));
    await state.pin("session-a");
    expect(pinFace.visible?.(target)).not.toBe(unpinFace.visible?.(target));
  });
});

describe("pinnedGroupFace", () => {
  it("claims a session exactly when it's pinned", async () => {
    const state = createPinState(fakeStorage());
    const face = pinnedGroupFace(state);
    expect(face.claim(session("session-a"))).toBe(false);
    await state.pin("session-a");
    expect(face.claim(session("session-a"))).toBe(true);
    await state.unpin("session-a");
    expect(face.claim(session("session-a"))).toBe(false);
  });

  it("subscribe forwards to the state's subscribe", () => {
    const state = createPinState(fakeStorage());
    const face = pinnedGroupFace(state);
    expect(face.subscribe).toBe(state.subscribe);
  });
});
