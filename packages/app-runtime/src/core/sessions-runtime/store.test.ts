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
  set: vi.fn(),
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
      remove: async () => {},
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
  }),
}));

import { dropMessages, loadIndex, loadSessionMeta } from "./store";

const HIDDEN_KEY = "sessions.runtime-hidden";

type Tombstone = { id: string; hiddenAt: number };

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

function storedTombstones(): Tombstone[] {
  return (mocks.storage[HIDDEN_KEY] ?? []) as Tombstone[];
}

function ids(sessions: { id: string }[]): string[] {
  return sessions.map((session) => session.id);
}

describe("sessions runtime tombstones", () => {
  beforeEach(() => {
    mocks.storage = {};
    mocks.summaries = [];
    mocks.set.mockReset();
  });

  it("migrates legacy string tombstones to the timestamped shape on read", async () => {
    mocks.storage[HIDDEN_KEY] = ["gone"];
    mocks.summaries = [summary("gone", 10), summary("kept", 20)];

    const before = Date.now();
    const index = await loadIndex();

    // A legacy deletion has no recorded time, so it is migrated with `now`
    // and stays hidden until the session's NEXT activity.
    expect(ids(index)).toEqual(["kept"]);
    const stored = storedTombstones();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("gone");
    expect(stored[0].hiddenAt).toBeGreaterThanOrEqual(before);
  });

  it("keeps a session hidden when its activity predates the deletion", async () => {
    mocks.storage[HIDDEN_KEY] = [{ id: "gone", hiddenAt: 300 }];
    mocks.summaries = [summary("gone", 200)];

    expect(ids(await loadIndex())).toEqual([]);
    expect(storedTombstones()).toEqual([{ id: "gone", hiddenAt: 300 }]);
  });

  it("revives a tombstoned session that gained activity after the deletion", async () => {
    // A host-side plugin resumed the session the user had deleted; the new
    // turn must bring the session back rather than vanish into the tombstone.
    mocks.storage[HIDDEN_KEY] = [{ id: "resumed", hiddenAt: 100 }];
    mocks.summaries = [summary("resumed", 200)];

    expect(ids(await loadIndex())).toEqual(["resumed"]);
    expect(storedTombstones()).toEqual([]);
  });

  it("persists lifted tombstones once per load, not once per session", async () => {
    mocks.storage[HIDDEN_KEY] = [
      { id: "a", hiddenAt: 100 },
      { id: "b", hiddenAt: 100 },
      { id: "c", hiddenAt: 900 },
    ];
    mocks.summaries = [summary("a", 200), summary("b", 300), summary("c", 400)];

    expect(ids(await loadIndex()).sort()).toEqual(["a", "b"]);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(storedTombstones()).toEqual([{ id: "c", hiddenAt: 900 }]);
  });

  it("writes no tombstone update when nothing was migrated or lifted", async () => {
    mocks.storage[HIDDEN_KEY] = [{ id: "gone", hiddenAt: 300 }];
    mocks.summaries = [summary("gone", 200), summary("kept", 400)];

    await loadIndex();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("lifts the tombstone when the session is explicitly opened by id", async () => {
    mocks.storage[HIDDEN_KEY] = [{ id: "gone", hiddenAt: 300 }];
    mocks.summaries = [summary("gone", 200)];

    await expect(loadSessionMeta("gone")).resolves.toMatchObject({
      id: "gone",
      agent: { profileId: "standard" },
    });
    expect(storedTombstones()).toEqual([]);
    expect(ids(await loadIndex())).toEqual(["gone"]);
  });

  it("leaves storage untouched when an unknown id is opened", async () => {
    mocks.storage[HIDDEN_KEY] = [{ id: "gone", hiddenAt: 300 }];
    mocks.summaries = [];

    await expect(loadSessionMeta("missing")).resolves.toBeUndefined();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(storedTombstones()).toEqual([{ id: "gone", hiddenAt: 300 }]);
  });

  it("hides a dropped session immediately and persists the timestamped shape", async () => {
    mocks.summaries = [summary("gone", 200), summary("kept", 300)];

    const before = Date.now();
    await dropMessages("gone");

    const stored = storedTombstones();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("gone");
    expect(stored[0].hiddenAt).toBeGreaterThanOrEqual(before);
    // The session's existing activity is older than the deletion, so an
    // immediate reload must not resurrect what the user just removed.
    expect(ids(await loadIndex())).toEqual(["kept"]);
  });

  it("tolerates garbage in the tombstone list", async () => {
    mocks.storage[HIDDEN_KEY] = [
      null,
      42,
      "",
      { hiddenAt: 1 },
      { id: "no-time" },
      { id: "gone", hiddenAt: "soon" },
      { id: "ok", hiddenAt: 100 },
    ];
    mocks.summaries = [summary("ok", 50), summary("no-time", 60)];

    expect(ids(await loadIndex())).toEqual([]);
    const stored = storedTombstones();
    expect(stored.map((entry) => entry.id).sort()).toEqual([
      "gone",
      "no-time",
      "ok",
    ]);
    for (const entry of stored) expect(typeof entry.hiddenAt).toBe("number");
  });

  it("ignores a tombstone value that is not a list", async () => {
    mocks.storage[HIDDEN_KEY] = { gone: true };
    mocks.summaries = [summary("gone", 200)];

    expect(ids(await loadIndex())).toEqual(["gone"]);
  });
});
