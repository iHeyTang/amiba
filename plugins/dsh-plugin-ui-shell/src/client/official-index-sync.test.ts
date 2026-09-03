import { describe, expect, it } from "vitest";

import { officialListFingerprint } from "./official-index-sync.js";

describe("officialListFingerprint", () => {
  const base = {
    ids: ["s1", "s2"],
    byId: {
      s1: { blank: false, title: "A", agentPreset: "standard", updatedAt: 1 },
      s2: { blank: true, updatedAt: 2 },
    },
  };

  it("changes when a host-created session appears", () => {
    const next = { ids: [...base.ids, "s3"], byId: { ...base.byId, s3: { blank: true } } };
    expect(officialListFingerprint(next)).not.toBe(officialListFingerprint(base));
  });

  it("changes when a blank session gets its first turn or a title", () => {
    const turned = { ...base, byId: { ...base.byId, s2: { blank: false } } };
    expect(officialListFingerprint(turned)).not.toBe(officialListFingerprint(base));
    const titled = { ...base, byId: { ...base.byId, s2: { blank: true, title: "Gold" } } };
    expect(officialListFingerprint(titled)).not.toBe(officialListFingerprint(base));
  });

  it("ignores streamed activity that only bumps updatedAt", () => {
    const streamed = { ...base, byId: { ...base.byId, s1: { ...base.byId.s1, updatedAt: 99 } } };
    expect(officialListFingerprint(streamed)).toBe(officialListFingerprint(base));
  });
});
