import { describe, expect, it, vi } from "vitest";

import { createStewardClientState } from "./state.js";

describe("createStewardClientState", () => {
  it("stores the steward session id and adopted ids, notifying subscribers", () => {
    const state = createStewardClientState();
    const listener = vi.fn();
    state.subscribe(listener);
    expect(state.stewardSessionId()).toBeNull();
    state.setStewardSessionId("session-s");
    expect(state.stewardSessionId()).toBe("session-s");
    state.setAdopted(["session-a", "session-b"]);
    expect([...state.adoptedSessionIds()]).toEqual(["session-a", "session-b"]);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
