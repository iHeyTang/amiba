import { describe, expect, it, vi } from "vitest";

import { createStewardClientState, stewardGroupFace, stewardMenuFace } from "./state.js";

describe("session-list contribution faces", () => {
  it("claim reads the live adopted set, flipping as setAdopted changes", () => {
    const state = createStewardClientState();
    const group = stewardGroupFace(state);
    const session = { id: "session-a", title: "Task a" };

    expect(group.claim(session)).toBe(false);

    state.setAdopted(["session-a"]);
    expect(group.claim(session)).toBe(true);

    // A refresh that drops the session (e.g. no longer adopted server-side)
    // flips the face back — no re-registration, same face object.
    state.setAdopted([]);
    expect(group.claim(session)).toBe(false);
  });

  it("only reports true for sessions actually in the adopted set", () => {
    const state = createStewardClientState();
    state.setAdopted(["session-a", "session-b"]);
    const group = stewardGroupFace(state);

    expect(group.claim({ id: "session-b", title: "b" })).toBe(true);
    expect(group.claim({ id: "session-c", title: "c" })).toBe(false);
  });

  it("subscribe fires on setAdopted, so the shell knows to re-render", () => {
    const state = createStewardClientState();
    const group = stewardGroupFace(state);
    const groupListener = vi.fn();

    const disposeGroup = group.subscribe?.(groupListener);
    expect(groupListener).not.toHaveBeenCalled();

    state.setAdopted(["session-a"]);
    expect(groupListener).toHaveBeenCalledTimes(1);

    state.setAdopted(["session-a", "session-b"]);
    expect(groupListener).toHaveBeenCalledTimes(2);

    disposeGroup?.();
    state.setAdopted([]);
    expect(groupListener).toHaveBeenCalledTimes(2);
  });
});

describe("stewardMenuFace", () => {
  it("is hidden for the steward session and for already-adopted sessions, visible otherwise", () => {
    const state = createStewardClientState();
    state.setStewardSessionId("session-s");
    state.setAdopted(["session-a"]);
    const menu = stewardMenuFace(state, { adopt: vi.fn(), refreshAdopted: vi.fn() });

    expect(menu.visible?.({ id: "session-s", title: "steward" })).toBe(false);
    expect(menu.visible?.({ id: "session-a", title: "adopted" })).toBe(false);
    expect(menu.visible?.({ id: "session-b", title: "ordinary" })).toBe(true);
  });

  it("run() adopts the session, adds it to the set, and refetches from the host", async () => {
    const state = createStewardClientState();
    const adopt = vi.fn().mockResolvedValue({ kind: "adopted", existing: false, task: { id: "t", sessionId: "session-x" } });
    const refreshAdopted = vi.fn().mockResolvedValue(undefined);
    const menu = stewardMenuFace(state, { adopt, refreshAdopted });

    await menu.run({ id: "session-x", title: "x" });

    expect(adopt).toHaveBeenCalledWith("session-x");
    expect(state.adoptedSessionIds().has("session-x")).toBe(true);
    expect(refreshAdopted).toHaveBeenCalledTimes(1);
  });

  it("run() does nothing extra when adopt routes to candidates instead of adopting", async () => {
    const state = createStewardClientState();
    const adopt = vi.fn().mockResolvedValue({ kind: "candidates", candidates: [] });
    const refreshAdopted = vi.fn().mockResolvedValue(undefined);
    const menu = stewardMenuFace(state, { adopt, refreshAdopted });

    await menu.run({ id: "session-y", title: "y" });

    expect(state.adoptedSessionIds().has("session-y")).toBe(false);
    expect(refreshAdopted).not.toHaveBeenCalled();
  });

  it("lets adopt's rejection propagate", async () => {
    const state = createStewardClientState();
    const adopt = vi.fn().mockRejectedValue(new Error("boom"));
    const menu = stewardMenuFace(state, { adopt, refreshAdopted: vi.fn() });

    await expect(menu.run({ id: "session-z", title: "z" })).rejects.toThrow("boom");
  });

  it("subscribe fires on setAdopted, same as group", () => {
    const state = createStewardClientState();
    const menu = stewardMenuFace(state, { adopt: vi.fn(), refreshAdopted: vi.fn() });
    const listener = vi.fn();

    menu.subscribe?.(listener);
    expect(listener).not.toHaveBeenCalled();
    state.setAdopted(["session-a"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
