import { describe, expect, it } from "vitest";

import { visibleChatSessions } from "./session-visibility";

const s = (id: string, profileId?: string, archived = false) => ({ id, archived, agent: profileId ? { profileId } : undefined });

describe("visibleChatSessions", () => {
  it("drops archived sessions and sessions bound to a hidden preset", () => {
    const sessions = [s("a", "standard"), s("b", "amiba-steward"), s("c", "standard", true), s("d")];
    expect(visibleChatSessions(sessions, new Set(["amiba-steward"])).map((x) => x.id)).toEqual(["a", "d"]);
    expect(visibleChatSessions(sessions).map((x) => x.id)).toEqual(["a", "b", "d"]);
  });

  it("compares preset ids case-insensitively, matching the sidebar's normalized profileId", () => {
    expect(visibleChatSessions([s("b", "amiba-steward")], new Set(["Amiba-Steward"]))).toEqual([]);
  });
});
