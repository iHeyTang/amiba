import { describe, expect, it } from "vitest";

import {
  resolveBadgeTexts,
  resolveMenuItems,
  type SessionBadgeSource,
  type SessionBadgeTarget,
  type SessionListMenuItem,
} from "./session-list-extensions";

const s = (id: string, extra: Partial<SessionBadgeTarget> = {}): SessionBadgeTarget => ({
  id,
  title: id,
  ...extra,
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
