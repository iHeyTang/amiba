// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  officialArchivedFingerprint,
  officialListFingerprint,
  useOfficialIndexRefresh,
} from "./official-index-sync.js";

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

describe("officialArchivedFingerprint", () => {
  it("changes when a session is archived", () => {
    expect(
      officialArchivedFingerprint({ archivedSessionIds: ["s1"] }),
    ).not.toBe(officialArchivedFingerprint({ archivedSessionIds: [] }));
  });

  it("changes when the host reorders or drops an id", () => {
    const base = { archivedSessionIds: ["s1", "s2"] };
    expect(officialArchivedFingerprint({ archivedSessionIds: ["s2", "s1"] })).not.toBe(
      officialArchivedFingerprint(base),
    );
    expect(officialArchivedFingerprint({ archivedSessionIds: ["s1"] })).not.toBe(
      officialArchivedFingerprint(base),
    );
  });

  it("is stable while the set is unchanged", () => {
    expect(officialArchivedFingerprint({ archivedSessionIds: ["s1"] })).toBe(
      officialArchivedFingerprint({ archivedSessionIds: ["s1"] }),
    );
  });
});

describe("useOfficialIndexRefresh", () => {
  function harness(initial: string[], ready = true) {
    const refresh = vi.fn();
    const view = renderHook(
      ({ fingerprints }: { fingerprints: string[] }) =>
        useOfficialIndexRefresh(fingerprints, ready, refresh),
      { initialProps: { fingerprints: initial } },
    );
    return { refresh, view };
  }

  it("re-reads the index when the ARCHIVED fingerprint alone changes", () => {
    const { refresh, view } = harness(["list", ""]);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Host archived a session: the session list is untouched, only the
    // workspaces store's archive set moved.
    view.rerender({ fingerprints: ["list", "s1"] });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not re-read while every fingerprint is unchanged", () => {
    const { refresh, view } = harness(["list", "s1"]);
    view.rerender({ fingerprints: ["list", "s1"] });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stays quiet until the index is ready", () => {
    const { refresh } = harness(["list", "s1"], false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
