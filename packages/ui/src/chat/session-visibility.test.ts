import { describe, expect, it, vi } from "vitest";

import {
  activeChatSessions,
  filterSearchMatches,
  visibleChatSessions,
} from "./session-visibility";

const s = (id: string, profileId?: string, archived = false) => ({ id, archived, agent: profileId ? { profileId } : undefined });

describe("visibleChatSessions", () => {
  it("keeps archived sessions and drops only sessions bound to a hidden preset", () => {
    const sessions = [s("a", "standard"), s("b", "hidden-preset"), s("c", "standard", true), s("d")];
    expect(visibleChatSessions(sessions, new Set(["hidden-preset"])).map((x) => x.id)).toEqual(["a", "c", "d"]);
    expect(visibleChatSessions(sessions).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("hides an archived session that is also bound to a hidden preset", () => {
    expect(
      visibleChatSessions([s("c", "hidden-preset", true)], new Set(["hidden-preset"])),
    ).toEqual([]);
  });

  it("compares preset ids case-insensitively, matching the sidebar's normalized profileId", () => {
    expect(visibleChatSessions([s("b", "hidden-preset")], new Set(["Hidden-Preset"]))).toEqual([]);
  });
});

describe("activeChatSessions", () => {
  it("drops archived sessions on top of the hidden-preset filter", () => {
    const sessions = [s("a", "standard"), s("b", "hidden-preset"), s("c", "standard", true), s("d")];
    expect(activeChatSessions(sessions, new Set(["hidden-preset"])).map((x) => x.id)).toEqual(["a", "d"]);
    expect(activeChatSessions(sessions).map((x) => x.id)).toEqual(["a", "b", "d"]);
  });
});

describe("filterSearchMatches", () => {
  it("applies the quick-picker filter to history-search results", async () => {
    const search = vi.fn(async () => [s("a", "standard"), s("b", "hidden-preset"), s("c", "standard", true)]);
    const filtered = filterSearchMatches(search, new Set(["hidden-preset"]))!;
    expect((await filtered("q")).map((x) => x.id)).toEqual(["a"]);
    expect(search).toHaveBeenCalledWith("q");
  });

  it("passes everything visible through when no preset is hidden, and stays undefined without a search", async () => {
    const search = vi.fn(async () => [s("a", "standard"), s("b", "hidden-preset")]);
    expect((await filterSearchMatches(search)!("q")).map((x) => x.id)).toEqual(["a", "b"]);
    expect(filterSearchMatches(undefined, new Set(["hidden-preset"]))).toBeUndefined();
  });
});
