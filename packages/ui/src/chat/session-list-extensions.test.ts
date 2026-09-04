import { describe, expect, it } from "vitest";

import {
  applyTriStateFilters,
  resolveBadgeTexts,
  resolveMenuItems,
  type SessionBadgeSource,
  type SessionBadgeTarget,
  type SessionListFilter,
  type SessionListMenuItem,
} from "./session-list-extensions";

const s = (id: string, extra: Partial<SessionBadgeTarget> = {}): SessionBadgeTarget => ({
  id,
  title: id,
  ...extra,
});

describe("applyTriStateFilters", () => {
  const adopted: SessionListFilter = {
    id: "adopted",
    label: "Steward",
    test: (session) => session.source === "steward",
  };
  const branched: SessionListFilter = {
    id: "branched",
    label: "Branched",
    test: (session) => Boolean(session.parentSessionId),
  };
  const sessions = [
    s("a", { source: "steward" }),
    s("b", { source: "steward", parentSessionId: "a" }),
    s("c"),
    s("d", { parentSessionId: "a" }),
  ];

  it("returns the input unchanged when no filter is active (all null)", () => {
    expect(applyTriStateFilters(sessions, [adopted, branched], {})).toEqual(sessions);
    expect(
      applyTriStateFilters(sessions, [adopted, branched], { adopted: null, branched: null }),
    ).toEqual(sessions);
  });

  it("returns the input unchanged when there are no filters at all", () => {
    expect(applyTriStateFilters(sessions, [], { adopted: true })).toEqual(sessions);
  });

  it("true keeps only matches", () => {
    expect(applyTriStateFilters(sessions, [adopted], { adopted: true }).map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("false keeps only non-matches", () => {
    expect(applyTriStateFilters(sessions, [adopted], { adopted: false }).map((x) => x.id)).toEqual(
      ["c", "d"],
    );
  });

  it("ANDs two active filters together", () => {
    expect(
      applyTriStateFilters(sessions, [adopted, branched], {
        adopted: true,
        branched: true,
      }).map((x) => x.id),
    ).toEqual(["b"]);
    expect(
      applyTriStateFilters(sessions, [adopted, branched], {
        adopted: true,
        branched: false,
      }).map((x) => x.id),
    ).toEqual(["a"]);
  });

  it("ignores a filter left null while another is active", () => {
    expect(
      applyTriStateFilters(sessions, [adopted, branched], {
        adopted: true,
        branched: null,
      }).map((x) => x.id),
    ).toEqual(["a", "b"]);
  });
});

describe("resolveBadgeTexts", () => {
  const stewardBadge: SessionBadgeSource = {
    id: "steward",
    order: 0,
    label: "Steward",
    resolve: (session) => session.source === "steward",
  };
  const channelBadge: SessionBadgeSource = {
    id: "channel",
    order: 1,
    label: "Channel",
    resolve: (session) => session.source ?? null,
  };
  const neverBadge: SessionBadgeSource = {
    id: "never",
    order: 2,
    label: "Never",
    resolve: () => false,
  };
  const nullBadge: SessionBadgeSource = {
    id: "null",
    order: 3,
    label: "Null",
    resolve: () => null,
  };

  it("uses the registered label when resolve returns true", () => {
    expect(resolveBadgeTexts(s("a", { source: "steward" }), [stewardBadge])).toEqual(["Steward"]);
  });

  it("uses the returned string when resolve returns a string", () => {
    expect(resolveBadgeTexts(s("a", { source: "lark" }), [channelBadge])).toEqual(["lark"]);
  });

  it("skips badges whose resolve returns false or null", () => {
    expect(resolveBadgeTexts(s("a"), [neverBadge, nullBadge])).toEqual([]);
  });

  it("preserves the given badge order in the output", () => {
    expect(
      resolveBadgeTexts(s("a", { source: "steward" }), [channelBadge, stewardBadge]),
    ).toEqual(["steward", "Steward"]);
    expect(
      resolveBadgeTexts(s("a", { source: "steward" }), [stewardBadge, channelBadge]),
    ).toEqual(["Steward", "steward"]);
  });

  it("returns an empty array for an empty badge list", () => {
    expect(resolveBadgeTexts(s("a"), [])).toEqual([]);
  });
});

describe("resolveMenuItems", () => {
  const alwaysItem: SessionListMenuItem = {
    id: "always",
    label: "Always",
    run: () => {},
  };
  const stewardOnlyItem: SessionListMenuItem = {
    id: "steward-only",
    label: "Steward only",
    visible: (session) => session.source === "steward",
    run: () => {},
  };
  const neverItem: SessionListMenuItem = {
    id: "never",
    label: "Never",
    visible: () => false,
    run: () => {},
  };

  it("keeps an item with no visible predicate", () => {
    expect(resolveMenuItems(s("a"), [alwaysItem]).map((i) => i.id)).toEqual([
      "always",
    ]);
  });

  it("keeps an item whose visible predicate returns true", () => {
    expect(
      resolveMenuItems(s("a", { source: "steward" }), [stewardOnlyItem]).map(
        (i) => i.id,
      ),
    ).toEqual(["steward-only"]);
  });

  it("drops an item whose visible predicate returns false", () => {
    expect(resolveMenuItems(s("a"), [stewardOnlyItem, neverItem])).toEqual([]);
  });

  it("preserves the given item order in the output", () => {
    expect(
      resolveMenuItems(s("a", { source: "steward" }), [
        stewardOnlyItem,
        alwaysItem,
      ]).map((i) => i.id),
    ).toEqual(["steward-only", "always"]);
  });

  it("returns an empty array for an empty item list", () => {
    expect(resolveMenuItems(s("a"), [])).toEqual([]);
  });
});
