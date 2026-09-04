import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  rename: vi.fn(),
  fork: vi.fn(),
  history: vi.fn(),
  archived: [] as string[],
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
        Object.assign(mocks.storage, patch);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete mocks.storage[key];
        }
      },
      watch: () => () => {},
    },
    agentWorkspaces: {
      list: async () => ({ items: [], archivedSessionIds: mocks.archived }),
      archiveSession: mocks.archiveSession,
    },
    agentSessions: {
      list: async () => [
        {
          sessionId: "dsh-1",
          updatedAt: 20,
          running: false,
          blank: false,
          title: "DSH task",
          agentPreset: "standard",
        },
        // A host-created session with no user turn yet: kept out of the
        // history list, but still openable by id with its real preset.
        {
          sessionId: "dsh-blank",
          updatedAt: 30,
          running: false,
          blank: true,
          agentPreset: "amiba-steward",
        },
      ],
      search: async () => [{ sessionId: "dsh-1", snippet: "match" }],
      create: async () => ({ sessionId: "dsh-new" }),
      history: mocks.history,
      rename: mocks.rename,
      fork: mocks.fork,
    },
  }),
}));

import { SessionsStore } from "./sessions-store";

describe("SessionsStore with DSH sessions", () => {
  beforeEach(() => {
    mocks.storage = {};
    mocks.archived = [];
    mocks.archiveSession.mockReset();
    mocks.archiveSession.mockImplementation(async (id: string) => {
      if (!mocks.archived.includes(id)) mocks.archived = [...mocks.archived, id];
      return { archivedSessionIds: mocks.archived };
    });
    mocks.rename.mockReset();
    mocks.fork.mockReset();
    mocks.fork.mockResolvedValue({ sessionId: "dsh-child" });
    mocks.history.mockReset();
    mocks.history.mockResolvedValue({
      events: [
        { event: { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } },
        {
          event: {
            type: "user/message",
            seq: 1,
            time: 2,
            data: {
              id: "u1",
              source: { kind: "user" },
              content: [{ type: "text", text: "hello" }],
            },
          },
        },
        {
          event: {
            type: "assistant/message",
            seq: 2,
            time: 3,
            data: {
              message: { content: [{ type: "text", text: "world" }] },
            },
          },
        },
        { event: { type: "turn/end", seq: 3, time: 4, data: {} } },
      ],
      hasMore: false,
    });
  });

  it("loads native DSH summaries and folds event history", async () => {
    const store = new SessionsStore();
    await store.initialize();
    expect(store.getSnapshot().sessions).toMatchObject([
      { id: "dsh-1", title: "DSH task", agent: { profileId: "standard" } },
    ]);
    await store.openTab("dsh-1");
    expect(store.getSnapshot().activeMessages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
    store.teardown();
  });

  it("opens a blank host session by id with the preset it already runs", async () => {
    // Regression: the steward plugin creates its conversation on the host
    // before the user ever types. The list drops blank sessions, so opening
    // one by id left the composer on the roster's default preset and the
    // first submit asked the host to re-create the session under it —
    // rejected with "already runs agent preset …; requested …".
    const store = new SessionsStore();
    await store.initialize();
    expect(
      store.getSnapshot().sessions.some((session) => session.id === "dsh-blank"),
    ).toBe(false);
    await store.openTab("dsh-blank");
    expect(store.getSnapshot().activeId).toBe("dsh-blank");
    expect(
      store.getSnapshot().sessions.find((session) => session.id === "dsh-blank"),
    ).toMatchObject({ id: "dsh-blank", agent: { profileId: "amiba-steward" } });
    store.teardown();
  });

  it("archives through the host, projects the set, and closes the tab", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("dsh-1");
    expect(store.getSnapshot().openTabIds).toEqual(["dsh-1"]);

    await store.archiveSession("dsh-1");

    expect(mocks.archiveSession).toHaveBeenCalledWith("dsh-1");
    expect(
      store.getSnapshot().sessions.find((session) => session.id === "dsh-1"),
    ).toMatchObject({ archived: true });
    // Archiving an open task takes it out of the tab strip.
    expect(store.getSnapshot().openTabIds).toEqual([]);
    // Nothing about the archive is written locally — DSH owns the set.
    expect(mocks.storage["sessions.local-meta"]).toEqual({});
    store.teardown();
  });

  it("batch-archives every selected id through the host", async () => {
    const store = new SessionsStore();
    await store.initialize();
    const extra = await store.createNew();

    await store.archiveSessions(["dsh-1", extra, "dsh-1", ""]);

    expect(mocks.archiveSession.mock.calls.map((call) => call[0])).toEqual([
      "dsh-1",
      extra,
    ]);
    expect(
      store
        .getSnapshot()
        .sessions.filter((session) => session.archived)
        .map((session) => session.id)
        .sort(),
    ).toEqual(["dsh-1", extra].sort());
    store.teardown();
  });

  it("uses DSH seq values when forking from a user message", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await expect(store.resolveUserMessageId("dsh-1", 0)).resolves.toBe(1);
    await store.branchSession("dsh-1", 1);
    expect(mocks.fork).toHaveBeenCalledWith("dsh-1", 1);
    store.teardown();
  });

  it("keeps derived/auto titles local — only manual renames reach DSH", async () => {
    // A DSH rename carries the `user` source, which pins the title
    // server-side and supersedes the runtime's automatic session-title
    // generation — so the locally derived first-sentence placeholder and
    // runtime-fed auto titles must never write back.
    mocks.rename.mockResolvedValue({ title: "My title", seq: 1 });

    const store = new SessionsStore();
    await store.initialize();
    const id = await store.createNew();
    await store.touchSession(id, [{ role: "user", content: "hello" }]);
    await store.applyAutoTitle(id, "Runtime generated title");
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(
      store.getSnapshot().sessions.find((session) => session.id === id)?.title,
    ).toBe("Runtime generated title");

    await store.rename(id, "My title");
    expect(mocks.rename).toHaveBeenCalledWith(id, "My title");

    // Manual titles are pinned locally too: auto titles no longer apply.
    await store.applyAutoTitle(id, "Late auto title");
    expect(
      store.getSnapshot().sessions.find((session) => session.id === id)?.title,
    ).toBe("My title");
    store.teardown();
  });
});
