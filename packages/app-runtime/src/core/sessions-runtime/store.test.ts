import { beforeEach, describe, expect, it, vi } from "vitest";

type Summary = {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  title?: string;
  agentPreset?: string;
};

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  summaries: [] as Summary[],
  archived: [] as string[],
  set: vi.fn(),
  removed: [] as string[],
  archiveSession: vi.fn(),
}));

vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({
    storage: {
      get: async (keys: string | string[]) => {
        const selected = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          selected.map((key) => [key, mocks.storage[key]]),
        );
      },
      set: async (patch: Record<string, unknown>) => {
        mocks.set(patch);
        Object.assign(mocks.storage, patch);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          mocks.removed.push(key);
          delete mocks.storage[key];
        }
      },
      watch: () => () => {},
    },
    agentSessions: {
      list: async () => mocks.summaries,
      search: async () => [],
      create: async () => ({ sessionId: "new" }),
      history: async () => ({ events: [], hasMore: false }),
      rename: async () => ({ title: "", seq: 0 }),
      fork: async () => ({ sessionId: "child" }),
    },
    agentWorkspaces: {
      list: async () => ({ items: [], archivedSessionIds: mocks.archived }),
      archiveSession: mocks.archiveSession,
    },
  }),
}));

import { archiveSession, loadIndex, loadSessionMeta } from "./store";

const HIDDEN_KEY = "sessions.runtime-hidden";
const LOCAL_META_KEY = "sessions.local-meta";
const MIGRATION_KEY = "sessions.archive-migrated";

function summary(id: string, updatedAt: number): Summary {
  return {
    sessionId: id,
    updatedAt,
    running: false,
    blank: false,
    title: id,
    agentPreset: "standard",
  };
}

function ids(sessions: { id: string }[]): string[] {
  return sessions.map((session) => session.id);
}

function archivedIds(sessions: { id: string; archived?: boolean }[]): string[] {
  return sessions.filter((session) => session.archived).map((s) => s.id);
}

function archiveCallIds(): string[] {
  return mocks.archiveSession.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  mocks.storage = {};
  mocks.summaries = [];
  mocks.archived = [];
  mocks.removed = [];
  mocks.set.mockReset();
  mocks.archiveSession.mockReset();
  // Every archive answers with the full updated set, exactly as DSH does.
  mocks.archiveSession.mockImplementation(async (id: string) => {
    if (!mocks.archived.includes(id)) mocks.archived = [...mocks.archived, id];
    return { archivedSessionIds: mocks.archived };
  });
});

describe("host archive projection", () => {
  it("marks a session archived when the HOST set names it", async () => {
    mocks.summaries = [summary("kept", 20), summary("filed", 10)];
    mocks.archived = ["filed"];

    const index = await loadIndex();
    expect(ids(index)).toEqual(["kept", "filed"]);
    expect(archivedIds(index)).toEqual(["filed"]);
  });

  it("ignores a stale sidecar archived flag — the host set is the truth", async () => {
    // Written by a build that still kept `archived` locally, and already
    // drained (the marker is set), so the flag must not resurface.
    mocks.storage[MIGRATION_KEY] = true;
    mocks.storage[LOCAL_META_KEY] = { ghost: { archived: true } };
    mocks.summaries = [summary("ghost", 10)];

    expect(archivedIds(await loadIndex())).toEqual([]);
  });

  it("keeps an archived session openable by id", async () => {
    mocks.summaries = [summary("filed", 10)];
    mocks.archived = ["filed"];

    await expect(loadSessionMeta("filed")).resolves.toMatchObject({
      id: "filed",
      archived: true,
      agent: { profileId: "standard" },
    });
  });

  it("archives through the host and answers with the updated set", async () => {
    mocks.archived = ["older"];
    await expect(archiveSession("fresh")).resolves.toEqual(
      new Set(["older", "fresh"]),
    );
    expect(archiveCallIds()).toEqual(["fresh"]);
  });
});

describe("legacy archive/tombstone migration", () => {
  it("drains both legacy keys into the host archive and clears them", async () => {
    mocks.storage[LOCAL_META_KEY] = {
      filed: { archived: true, unread: true },
      plain: { titleManual: true },
    };
    // Mixed shapes: the oldest bare-id form and the timestamped one.
    mocks.storage[HIDDEN_KEY] = [
      "bare",
      { id: "stamped", hiddenAt: 100 },
      null,
      { hiddenAt: 1 },
      "",
    ];
    mocks.summaries = [summary("filed", 10), summary("bare", 20), summary("stamped", 30)];

    const index = await loadIndex();

    expect(archiveCallIds().sort()).toEqual(["bare", "filed", "stamped"]);
    expect(archivedIds(index).sort()).toEqual(["bare", "filed", "stamped"]);
    // The tombstone key is gone; the sidecar keeps everything but `archived`.
    expect(mocks.removed).toContain(HIDDEN_KEY);
    expect(mocks.storage[HIDDEN_KEY]).toBeUndefined();
    expect(mocks.storage[LOCAL_META_KEY]).toEqual({
      filed: { unread: true },
      plain: { titleManual: true },
    });
    expect(mocks.storage[MIGRATION_KEY]).toBe(true);
  });

  it("tolerates one id the host cannot archive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.archiveSession.mockImplementation(async (id: string) => {
      if (id === "gone") {
        throw Object.assign(new Error("no such session"), {
          code: "session-not-found",
        });
      }
      mocks.archived = [...mocks.archived, id];
      return { archivedSessionIds: mocks.archived };
    });
    mocks.storage[HIDDEN_KEY] = ["gone", "real"];
    mocks.summaries = [summary("real", 10)];

    const index = await loadIndex();

    expect(archiveCallIds().sort()).toEqual(["gone", "real"]);
    expect(archivedIds(index)).toEqual(["real"]);
    expect(warn).toHaveBeenCalled();
    expect(mocks.storage[MIGRATION_KEY]).toBe(true);
    warn.mockRestore();
  });

  it("runs exactly once", async () => {
    mocks.storage[HIDDEN_KEY] = ["bare"];
    mocks.summaries = [summary("bare", 10)];

    await loadIndex();
    expect(archiveCallIds()).toEqual(["bare"]);

    // A second load (or a second window) must not re-archive anything, and
    // must not resurrect the key it just cleared.
    await loadIndex();
    expect(archiveCallIds()).toEqual(["bare"]);
    expect(mocks.storage[HIDDEN_KEY]).toBeUndefined();
  });

  it("leaves both legacy keys and the marker alone when the host is unreachable", async () => {
    // Post-upgrade first load with the DSH connection not up yet: every
    // archive call fails with a transport error, so nothing was handled and
    // the drain must stay pending rather than silently dropping the ids.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.archiveSession.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    mocks.storage[LOCAL_META_KEY] = { filed: { archived: true, unread: true } };
    mocks.storage[HIDDEN_KEY] = ["bare"];
    mocks.summaries = [summary("filed", 10), summary("bare", 20)];

    await loadIndex();

    expect(archiveCallIds().sort()).toEqual(["bare", "filed"]);
    expect(mocks.storage[MIGRATION_KEY]).toBeUndefined();
    expect(mocks.storage[HIDDEN_KEY]).toEqual(["bare"]);
    expect(mocks.storage[LOCAL_META_KEY]).toEqual({
      filed: { archived: true, unread: true },
    });
    expect(mocks.removed).not.toContain(HIDDEN_KEY);

    // The next load — host back up — drains what the failed pass left behind.
    mocks.archiveSession.mockImplementation(async (id: string) => {
      if (!mocks.archived.includes(id)) mocks.archived = [...mocks.archived, id];
      return { archivedSessionIds: mocks.archived };
    });
    const index = await loadIndex();

    expect(archivedIds(index).sort()).toEqual(["bare", "filed"]);
    expect(mocks.storage[MIGRATION_KEY]).toBe(true);
    expect(mocks.storage[HIDDEN_KEY]).toBeUndefined();
    expect(mocks.storage[LOCAL_META_KEY]).toEqual({ filed: { unread: true } });
    warn.mockRestore();
  });

  it("keeps only the ids the host actually refused, and stays unmarked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.archiveSession.mockImplementation(async (id: string) => {
      if (id === "flaky") throw new Error("temporarily unavailable");
      if (id === "gone") {
        throw Object.assign(new Error("no such session"), {
          code: "session-not-found",
        });
      }
      mocks.archived = [...mocks.archived, id];
      return { archivedSessionIds: mocks.archived };
    });
    mocks.storage[LOCAL_META_KEY] = {
      flaky: { archived: true, unread: true },
      filed: { archived: true },
    };
    mocks.storage[HIDDEN_KEY] = ["gone", "bare"];
    mocks.summaries = [summary("filed", 10), summary("bare", 20)];

    const index = await loadIndex();

    expect(archivedIds(index).sort()).toEqual(["bare", "filed"]);
    // `gone` was answered by the host (session-not-found) — handled, dropped;
    // `bare` archived fine, so the tombstone key drained completely.
    expect(mocks.storage[HIDDEN_KEY]).toBeUndefined();
    // Only the id that genuinely failed keeps its legacy marker.
    expect(mocks.storage[LOCAL_META_KEY]).toEqual({
      flaky: { archived: true, unread: true },
    });
    expect(mocks.storage[MIGRATION_KEY]).toBeUndefined();
    warn.mockRestore();
  });

  it("marks itself done even with nothing to drain", async () => {
    mocks.summaries = [summary("kept", 10)];

    await loadIndex();
    expect(mocks.archiveSession).not.toHaveBeenCalled();
    expect(mocks.storage[MIGRATION_KEY]).toBe(true);
  });
});
