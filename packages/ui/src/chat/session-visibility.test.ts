import { describe, expect, it, vi } from "vitest";

import { filterSearchMatches, isRuntimeOwnedSession, visibleChatSessions } from "./session-visibility";

const s = (id: string, profileId?: string, archived = false) => ({ id, archived, agent: profileId ? { profileId } : undefined });

describe("visibleChatSessions", () => {
  it("drops archived sessions and sessions bound to a hidden preset", () => {
    const sessions = [s("a", "standard"), s("b", "hidden-preset"), s("c", "standard", true), s("d")];
    expect(visibleChatSessions(sessions, new Set(["b"])).map((x) => x.id)).toEqual(["a", "d"]);
    expect(visibleChatSessions(sessions).map((x) => x.id)).toEqual(["a", "b", "d"]);
  });

  it("hides an archived session that is also bound to a hidden preset", () => {
    expect(
      visibleChatSessions([s("c", "hidden-preset", true)], new Set(["b"])),
    ).toEqual([]);
  });

  it("uses session identity even when multiple sessions have the same preset", () => {
    expect(visibleChatSessions([s("b", "hidden-preset")], new Set(["b"]))).toEqual([]);
  });
});

describe("isRuntimeOwnedSession", () => {
  it("is true for a session bound to a hidden preset", () => {
    expect(isRuntimeOwnedSession(s("b", "hidden-preset"), new Set(["b"]))).toBe(true);
  });

  it("is false for an ordinary session", () => {
    expect(isRuntimeOwnedSession(s("a", "standard"), new Set(["b"]))).toBe(false);
  });

  it("is false when there is no active session, or no hidden presets configured", () => {
    expect(isRuntimeOwnedSession(undefined, new Set(["b"]))).toBe(false);
    expect(isRuntimeOwnedSession(s("b", "hidden-preset"))).toBe(false);
    expect(isRuntimeOwnedSession(s("b", "hidden-preset"), new Set())).toBe(false);
  });

  it("does not depend on preset name casing", () => {
    expect(isRuntimeOwnedSession(s("b", "Hidden-Preset"), new Set(["b"]))).toBe(true);
  });
});

describe("filterSearchMatches", () => {
  it("applies the visibility filter to history-search results", async () => {
    const search = vi.fn(async () => [s("a", "standard"), s("b", "hidden-preset"), s("c", "standard", true)]);
    const filtered = filterSearchMatches(search, new Set(["b"]))!;
    expect((await filtered("q")).map((x) => x.id)).toEqual(["a"]);
    expect(search).toHaveBeenCalledWith("q");
  });

  it("passes everything visible through when no preset is hidden, and stays undefined without a search", async () => {
    const search = vi.fn(async () => [s("a", "standard"), s("b", "hidden-preset")]);
    expect((await filterSearchMatches(search)!("q")).map((x) => x.id)).toEqual(["a", "b"]);
    expect(filterSearchMatches(undefined, new Set(["b"]))).toBeUndefined();
  });
});

it("excludes delegated children from history and search but keeps user forks", async () => {
  const sessions = [
    {id:"parent"},
    {id:"child", origin:"subagent" as const, parentSessionId:"parent"},
    {id:"fork", parentSessionId:"parent"},
  ];
  expect(visibleChatSessions(sessions).map(s=>s.id)).toEqual(["parent", "fork"]);
  expect((await filterSearchMatches(async()=>sessions)!("query")).map(s=>s.id)).toEqual(["parent", "fork"]);
});
