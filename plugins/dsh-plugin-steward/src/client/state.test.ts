import { describe, expect, it, vi } from "vitest";

import { STEWARD_PRESET } from "../preset-seed.js";
import { STEWARD_SOURCE as HOST_STEWARD_SOURCE } from "../service.js";
import { STEWARD_PRESET_ID, STEWARD_SOURCE } from "../types.js";
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

describe("STEWARD_PRESET_ID", () => {
  it("hides the same preset id the host seeds", () => {
    // The client's `hidePreset(STEWARD_PRESET_ID)` call (src/client/index.tsx)
    // and the host's seeded preset directory (src/preset-seed.ts) must name
    // the exact same agent preset, or the steward session would either show
    // up in the history list or the wrong preset would get hidden. Both
    // sides import the id from the single browser-safe source, `../types.js`.
    expect(STEWARD_PRESET_ID).toBe(STEWARD_PRESET.id);
  });
});

describe("STEWARD_SOURCE", () => {
  it("labels dispatched messages with the same source id the host writes", () => {
    // The client's `amiba.message.source` registration (src/client/index.tsx)
    // must claim the exact id the host writes into a dispatched message's
    // `source.plugin` (service.ts's relay send), or the chat bubble would
    // fall back to showing the raw plugin id instead of "来自 大管家". Both
    // sides trace back to the single browser-safe source, `../types.js` —
    // `service.ts` merely re-exports it for the host's own imports.
    expect(STEWARD_SOURCE).toBe(HOST_STEWARD_SOURCE);
  });
});
