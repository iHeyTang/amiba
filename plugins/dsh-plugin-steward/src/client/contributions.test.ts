import { describe, expect, it, vi } from "vitest";

import { createStewardClientState, stewardBadgeFace, stewardFilterFace } from "./state.js";

describe("session-list contribution faces", () => {
  it("resolve/test read the live adopted set, flipping as setAdopted changes", () => {
    const state = createStewardClientState();
    const badge = stewardBadgeFace(state);
    const filter = stewardFilterFace(state);
    const session = { id: "session-a", title: "Task a" };

    expect(badge.resolve(session)).toBe(false);
    expect(filter.test(session)).toBe(false);

    state.setAdopted(["session-a"]);
    expect(badge.resolve(session)).toBe(true);
    expect(filter.test(session)).toBe(true);

    // A refresh that drops the session (e.g. no longer adopted server-side)
    // flips both faces back — no re-registration, same face objects.
    state.setAdopted([]);
    expect(badge.resolve(session)).toBe(false);
    expect(filter.test(session)).toBe(false);
  });

  it("only reports true for sessions actually in the adopted set", () => {
    const state = createStewardClientState();
    state.setAdopted(["session-a", "session-b"]);
    const badge = stewardBadgeFace(state);
    const filter = stewardFilterFace(state);

    expect(badge.resolve({ id: "session-a", title: "a" })).toBe(true);
    expect(badge.resolve({ id: "session-c", title: "c" })).toBe(false);
    expect(filter.test({ id: "session-b", title: "b" })).toBe(true);
    expect(filter.test({ id: "session-c", title: "c" })).toBe(false);
  });

  it("subscribe fires on setAdopted, so the shell knows to re-render", () => {
    const state = createStewardClientState();
    const badge = stewardBadgeFace(state);
    const filter = stewardFilterFace(state);
    const badgeListener = vi.fn();
    const filterListener = vi.fn();

    const disposeBadge = badge.subscribe?.(badgeListener);
    const disposeFilter = filter.subscribe?.(filterListener);
    expect(badgeListener).not.toHaveBeenCalled();
    expect(filterListener).not.toHaveBeenCalled();

    state.setAdopted(["session-a"]);
    expect(badgeListener).toHaveBeenCalledTimes(1);
    expect(filterListener).toHaveBeenCalledTimes(1);

    state.setAdopted(["session-a", "session-b"]);
    expect(badgeListener).toHaveBeenCalledTimes(2);
    expect(filterListener).toHaveBeenCalledTimes(2);

    // Both faces share the same underlying `state.subscribe` — disposing
    // one must not silence the other.
    disposeBadge?.();
    state.setAdopted([]);
    expect(badgeListener).toHaveBeenCalledTimes(2);
    expect(filterListener).toHaveBeenCalledTimes(3);
    disposeFilter?.();
  });
});
