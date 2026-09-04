import { describe, expect, it } from "vitest";

import {
  partitionSessionGroups,
  resolveBadgeTexts,
  resolveMenuItems,
  type SessionBadgeSource,
  type SessionBadgeTarget,
  type SessionListGroup,
  type SessionListMenuItem,
} from "./session-list-extensions";

const s = (id: string, extra: Partial<SessionBadgeTarget> = {}): SessionBadgeTarget => ({
  id,
  title: id,
  ...extra,
});

interface DatedTarget extends SessionBadgeTarget {
  updatedAt: number;
}

const d = (
  id: string,
  updatedAt: number,
  extra: Partial<DatedTarget> = {},
): DatedTarget => ({ id, title: id, updatedAt, ...extra });

describe("partitionSessionGroups", () => {
  const steward: SessionListGroup = {
    id: "steward",
    label: "Steward",
    claim: (session) => session.source === "steward",
  };
  const pinned: SessionListGroup = {
    id: "pinned",
    label: "Pinned",
    claim: (session) => session.id.startsWith("p"),
  };

  it("puts a claimed session under its group and not in rest", () => {
    const sessions = [d("a", 1, { source: "steward" }), d("b", 2)];
    const result = partitionSessionGroups(sessions, [steward]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.group).toBe(steward);
    expect(result.groups[0]?.items.map((x) => x.id)).toEqual(["a"]);
    expect(result.rest.map((x) => x.id)).toEqual(["b"]);
  });

  it("omits a group nothing claims", () => {
    const sessions = [d("b", 2)];
    const result = partitionSessionGroups(sessions, [steward]);
    expect(result.groups).toEqual([]);
    expect(result.rest.map((x) => x.id)).toEqual(["b"]);
  });

  it("gives an ambiguously-claimable session to the first group in order", () => {
    // "p1" starts with "p" (pinned claims it) AND is steward-sourced.
    const both: SessionListGroup = {
      id: "both-claim",
      label: "Both",
      claim: () => true,
    };
    const sessions = [d("p1", 1, { source: "steward" })];
    const first = partitionSessionGroups(sessions, [steward, both]);
    expect(first.groups.map((g) => g.group.id)).toEqual(["steward"]);
    expect(first.groups[0]?.items.map((x) => x.id)).toEqual(["p1"]);

    const reordered = partitionSessionGroups(sessions, [both, steward]);
    expect(reordered.groups.map((g) => g.group.id)).toEqual(["both-claim"]);
  });

  it("leaves unclaimed sessions in rest, in their input order", () => {
    const sessions = [d("x", 3), d("y", 1), d("z", 2)];
    const result = partitionSessionGroups(sessions, [steward, pinned]);
    expect(result.groups).toEqual([]);
    expect(result.rest.map((s) => s.id)).toEqual(["x", "y", "z"]);
  });

  it("sorts each group's items newest-first by updatedAt", () => {
    const sessions = [
      d("a", 1, { source: "steward" }),
      d("b", 3, { source: "steward" }),
      d("c", 2, { source: "steward" }),
    ];
    const result = partitionSessionGroups(sessions, [steward]);
    expect(result.groups[0]?.items.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("renders groups in the input groups order, each holding only its own claims", () => {
    const sessions = [
      d("s1", 1, { source: "steward" }),
      d("p1", 2),
      d("p2", 3),
      d("s2", 4, { source: "steward" }),
    ];
    const result = partitionSessionGroups(sessions, [steward, pinned]);
    expect(result.groups.map((g) => g.group.id)).toEqual(["steward", "pinned"]);
    expect(result.groups[0]?.items.map((x) => x.id)).toEqual(["s2", "s1"]);
    expect(result.groups[1]?.items.map((x) => x.id)).toEqual(["p2", "p1"]);
    expect(result.rest).toEqual([]);
  });

  it("returns everything in rest when there are no groups", () => {
    const sessions = [d("a", 1), d("b", 2)];
    const result = partitionSessionGroups(sessions, []);
    expect(result.groups).toEqual([]);
    expect(result.rest).toEqual(sessions);
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
