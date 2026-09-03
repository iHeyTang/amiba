import { describe, expect, it } from "vitest";

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
});
