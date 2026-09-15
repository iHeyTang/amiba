import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  listGate: undefined as Promise<void> | undefined,
  extra: [] as Array<{ sessionId: string; updatedAt: number; running: boolean; blank: boolean; title: string }>,
  rename: vi.fn(),
  fork: vi.fn(),
  history: vi.fn(),
  archived: [] as string[],
  archiveSession: vi.fn(),
  watch: vi.fn((_keys: unknown, _listener: (changes: unknown) => void) => () => {}),
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
      watch: mocks.watch,
    },
    agentWorkspaces: {
      list: async () => ({ items: [], archivedSessionIds: mocks.archived }),
      archiveSession: mocks.archiveSession,
    },
    agentSessions: {
      list: async () => {
        await mocks.listGate;
        return [
        ...mocks.extra,        {
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
      ];
      },
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
  it("reloads an already selected session when its catalog transport is discovered", async () => {
    mocks.extra = [{ sessionId: "catalog-child", updatedAt: 10, running: false, blank: false, title: "Child" }];
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("catalog-child");
    mocks.history.mockClear();
    const address = { parentSessionId: "dsh-1", childSessionId: "catalog-child", mode: "one-shot" as const };
    await store.openTab("catalog-child", address);
    expect(mocks.history.mock.calls).toEqual([["catalog-child", { subagent: address, maxMessages: 200 }]]);
    address.parentSessionId = "changed-by-caller";
    expect(store.getSnapshot().sessions.find((row) => row.id === "catalog-child")?.subagentAddress?.parentSessionId).toBe("dsh-1");
    store.teardown();
  });

  it("opens an unlisted catalog child and preserves its address across tabs, export and a new store", async () => {
    const address = { parentSessionId: "dsh-1", childSessionId: "catalog-child", mode: "continuable" as const };
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("catalog-child", address);
    expect(store.getSnapshot().activeId).toBe("catalog-child");
    expect(store.getSnapshot().sessions.find((row) => row.id === "catalog-child")).toMatchObject({
      origin: "subagent", parentSessionId: "dsh-1", subagentAddress: address,
    });
    await store.openTab("dsh-1");
    await store.refresh();
    await store.switchToTab("catalog-child");
    await store.exportSession("catalog-child");
    await store.resolveUserMessageId("catalog-child", 0);
    store.teardown();
    const reopened = new SessionsStore();
    await reopened.initialize();
    expect(reopened.getSnapshot().activeId).toBe("");
    await reopened.openTab("catalog-child");
    expect(reopened.getSnapshot().activeId).toBe("catalog-child");
    const childReads = mocks.history.mock.calls.filter(([id]) => id === "catalog-child");
    expect(childReads).toHaveLength(5);
    for (const [, options] of childReads) expect(options.subagent).toEqual(address);
    reopened.teardown();
  });

  it("retains a child address discovered during an older index refresh", async () => {
    mocks.extra = [{ sessionId: "catalog-child", updatedAt: 10, running: false, blank: false, title: "Child" }];
    const store = new SessionsStore();
    await store.initialize();
    let release!: () => void;
    mocks.listGate = new Promise<void>((resolve) => { release = resolve; });
    const refresh = store.refresh();
    await Promise.resolve();
    await Promise.resolve();
    mocks.listGate = undefined;
    const address = { parentSessionId: "dsh-1", childSessionId: "catalog-child", mode: "one-shot" as const };
    await store.openTab("catalog-child", address);
    release();
    await refresh;
    expect(store.getSnapshot().sessions.find((row) => row.id === "catalog-child")?.subagentAddress).toEqual(address);
    await store.openTab("dsh-1");
    mocks.history.mockClear();
    await store.switchToTab("catalog-child");
    expect(mocks.history.mock.calls).toEqual([["catalog-child", { subagent: address, maxMessages: 200 }]]);
    store.teardown();
  });

  it("keeps an open child address when another window broadcasts an older row", async () => {
    const store = new SessionsStore();
    await store.initialize();
    const address = { parentSessionId: "dsh-1", childSessionId: "catalog-child", mode: "continuable" as const };
    await store.openTab("catalog-child", address);
    const listener = mocks.watch.mock.calls.at(-1)![1];
    listener({ "sessions.index": { newValue: [{
      id: "catalog-child", title: "Updated elsewhere", updatedAt: 50,
    }] } });
    expect(store.getSnapshot().sessions.find((row) => row.id === "catalog-child")).toMatchObject({
      title: "Updated elsewhere", subagentAddress: address, parentSessionId: "dsh-1",
    });
    store.teardown();
  });

  it("accepts explicit incoming child metadata instead of retaining an obsolete address", async () => {
    const store = new SessionsStore();
    await store.initialize();
    const address = { parentSessionId: "dsh-1", childSessionId: "catalog-child", mode: "one-shot" as const };
    await store.openTab("catalog-child", address);
    const listener = mocks.watch.mock.calls.at(-1)![1];
    const updated = { ...address, mode: "continuable" as const };
    listener({ "sessions.index": { newValue: [{
      id: "catalog-child", updatedAt: 50, subagentAddress: updated, parentSessionId: "dsh-1",
    }] } });
    expect(store.getSnapshot().sessions.find((row) => row.id === "catalog-child")?.subagentAddress).toEqual(updated);
    listener({ "sessions.index": { newValue: [{
      id: "catalog-child", updatedAt: 60, parentSessionId: "different-parent",
    }] } });
    expect(store.getSnapshot().sessions.find((row) => row.id === "catalog-child")).toMatchObject({
      parentSessionId: "different-parent",
    });
    expect(store.getSnapshot().sessions.find((row) => row.id === "catalog-child")?.subagentAddress).toBeUndefined();
    store.teardown();
  });

  it("does not open a child when the supplied address names a different session", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await expect(store.openTab("catalog-child", {
      parentSessionId: "dsh-1", childSessionId: "other", mode: "one-shot",
    })).rejects.toThrow("Invalid subagent");
    expect(store.getSnapshot().openTabIds).toEqual([]);
    expect(mocks.history).not.toHaveBeenCalled();
    store.teardown();
  });

  it("preserves selection when addressed history fails without requesting ordinary child history", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("dsh-1");
    mocks.history.mockClear();
    mocks.history.mockRejectedValueOnce(new Error("catalog unavailable"));
    const address = { parentSessionId: "dsh-1", childSessionId: "catalog-child", mode: "one-shot" as const };
    await expect(store.openTab("catalog-child", address)).rejects.toThrow("catalog unavailable");
    expect(store.getSnapshot().activeId).toBe("dsh-1");
    expect(mocks.history.mock.calls).toEqual([["catalog-child", { subagent: address, maxMessages: 200 }]]);
    store.teardown();
  });

  it("retains a completion that beats the host session index", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.markUnread("cron-fast", 100);
    mocks.extra = [{ sessionId: "cron-fast", updatedAt: 100, running: false, blank: false, title: "Fast cron" }];
    await store.refresh();
    expect(store.getSnapshot().sessions.find((row) => row.id === "cron-fast")?.unread).toBe(true);
    store.teardown();
  });

  it("keeps a read acknowledgement made during a slow index refresh", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.markUnread("dsh-1", 50);
    let release!: () => void;
    mocks.listGate = new Promise<void>((resolve) => { release = resolve; });
    const refresh = store.refresh();
    // loadIndex reads the old sidecar before waiting for the host list.
    await Promise.resolve();
    await Promise.resolve();
    await store.markRead("dsh-1", 100);
    release();
    await refresh;
    expect(store.getSnapshot().sessions[0]?.unread).toBeUndefined();
    expect(store.getSnapshot().sessions[0]?.readAt).toBe(100);
    store.teardown();
  });

  it("persists acknowledgements across restart and only marks newer activity unread", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.markUnread("dsh-1", 50);
    await store.markRead("dsh-1", 100);
    store.teardown();
    const restarted = new SessionsStore();
    await restarted.initialize();
    await restarted.markUnread("dsh-1", 50);
    expect(restarted.getSnapshot().sessions[0]).toMatchObject({ readAt: 100 });
    expect(restarted.getSnapshot().sessions[0]?.unread).toBeUndefined();
    await restarted.markUnread("dsh-1", 101);
    expect(restarted.getSnapshot().sessions[0]?.unread).toBe(true);
    restarted.teardown();
  });

  it("marks an active tab unread when its caller reports activity behind another view", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("dsh-1");
    await store.markUnread("dsh-1", Date.now() + 100);
    expect(store.getSnapshot().sessions[0]?.unread).toBe(true);
    await store.openTab("dsh-1");
    expect(store.getSnapshot().sessions[0]?.unread).toBeUndefined();
    store.teardown();
  });

  it("publishes a failed destination and clears it after retry succeeds", async () => {
    const store = new SessionsStore();
    await store.initialize();
    mocks.history.mockRejectedValueOnce(new Error("unsupported session format"));
    await expect(store.openTab("dsh-1")).rejects.toThrow("unsupported session format");
    expect(store.getSnapshot().sessionLoad).toEqual({ sessionId: "dsh-1", status: "error", message: "unsupported session format" });
    expect(store.getSnapshot().activeId).toBe("");
    await store.openTab("dsh-1");
    expect(store.getSnapshot().sessionLoad).toBeUndefined();
    expect(store.getSnapshot().activeId).toBe("dsh-1");
    store.teardown();
  });

  it("does not restore a stale failure after returning Home", async () => {
    const store = new SessionsStore();
    await store.initialize();
    let reject!: (error: Error) => void;
    mocks.history.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const opening = store.openTab("dsh-1");
    const failure = expect(opening).rejects.toThrow("late failure");
    await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
    expect(store.getSnapshot().sessionLoad).toEqual({ sessionId: "dsh-1", status: "loading" });
    await store.deselect();
    reject(new Error("late failure"));
    await failure;
    expect(store.getSnapshot().sessionLoad).toBeUndefined();
    expect(store.getSnapshot().activeId).toBe("");
    store.teardown();
  });

  it("does not acknowledge a conversation whose history failed to open", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.markUnread("dsh-1", 100);
    mocks.history.mockRejectedValueOnce(new Error("offline"));
    await expect(store.openTab("dsh-1")).rejects.toThrow("offline");
    expect(store.getSnapshot().sessions[0]?.unread).toBe(true);
    store.teardown();
  });

  it("cancels an in-flight history open when deselected from Home", async () => {
    const store = new SessionsStore();
    await store.initialize();
    let release!: (value: unknown) => void;
    mocks.history.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const opening = store.openTab("dsh-1");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await store.deselect();
    release({events:[]});
    await opening;
    expect(store.getSnapshot().activeId).toBe("");
    expect(store.getSnapshot().openTabIds).toEqual(["dsh-1"]);
    store.teardown();
  });

  it("cancels an unknown-session metadata lookup before it can select a tab", async () => {
    const store = new SessionsStore();
    await store.initialize();
    let release!: () => void;
    mocks.listGate = new Promise(resolve => { release = resolve; });
    const opening = store.openTab("dsh-blank");
    await Promise.resolve();
    await store.deselect();
    release();
    await opening;
    expect(store.getSnapshot().activeId).toBe("");
    expect(store.getSnapshot().openTabIds).toEqual([]);
    store.teardown();
  });

  beforeEach(() => {
    mocks.watch.mockClear();
    mocks.storage = {};
    mocks.extra = [];
    mocks.listGate = undefined;
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

  it("keeps a newly submitted local session selected across host refreshes", async () => {
    const store = new SessionsStore();
    await store.initialize();
    const id = await store.createNew({ profileId: "standard" });
    const messages = [{ role: "user" as const, content: "first prompt" }];
    store.setActiveMessages(messages);

    // The host publishes its list before the first turn materializes.
    await store.refresh();
    await store.refresh();

    expect(store.getSnapshot()).toMatchObject({
      activeId: id,
      openTabIds: [id],
      activeMessages: messages,
    });
    expect(store.getSnapshot().sessions).toContainEqual(
      expect.objectContaining({ id, agent: { profileId: "standard" } }),
    );
    store.teardown();
  });

  it("does not run a delayed message updater against a different selected session or Home", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("dsh-1");
    const update = vi.fn((messages) => [...messages, { role: "user", content: "wrong target" }]);
    await store.openTab("dsh-blank");
    const before = store.getSnapshot();
    expect(store.updateActiveMessagesFor("dsh-1", update)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    await store.deselect();
    expect(store.updateActiveMessagesFor("dsh-1", update)).toBe(false);
    expect(store.updateActiveMessagesFor("", update)).toBe(false);
    expect(update).not.toHaveBeenCalled();
    store.teardown();
  });

  it("applies addressed updates to the latest messages after returning to the target", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("dsh-1");
    await store.openTab("dsh-blank");
    await store.openTab("dsh-1");
    const messages = [{ role: "user" as const, content: "latest target history" }];
    store.setActiveMessages(messages);
    const update = vi.fn(prev => [...prev, { role: "assistant" as const, content: "target update" }]);
    expect(store.updateActiveMessagesFor("dsh-1", update)).toBe(true);
    expect(update).toHaveBeenCalledWith(messages);
    expect(store.getSnapshot().activeMessages).toEqual([...messages, { role: "assistant", content: "target update" }]);
    const before = store.getSnapshot();
    expect(store.updateActiveMessagesFor("dsh-1", prev => prev)).toBe(true);
    expect(store.getSnapshot()).toBe(before);
    store.teardown();
  });

  it("keeps an explicitly opened blank host session through a refresh", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await store.openTab("dsh-blank");
    await store.refresh();
    expect(store.getSnapshot().activeId).toBe("dsh-blank");
    expect(store.getSnapshot().openTabIds).toEqual(["dsh-blank"]);
    expect(store.getSnapshot().sessions).toContainEqual(
      expect.objectContaining({
        id: "dsh-blank",
        agent: { profileId: "amiba-steward" },
      }),
    );
    store.teardown();
  });

  it("preserves open drafts on broadcasts and replaces them with host metadata", async () => {
    const store = new SessionsStore();
    await store.initialize();
    const id = await store.createNew();
    const notify = mocks.watch.mock.calls[0]![1] as (changes: unknown) => void;
    notify({ "sessions.index": { newValue: [] } });
    expect(store.getSnapshot().activeId).toBe(id);
    expect(store.getSnapshot().sessions.map((session) => session.id)).toEqual([id]);

    const materialized = { id, title: "Host title", createdAt: 10, updatedAt: 20 };
    notify({ "sessions.index": { newValue: [materialized] } });
    expect(store.getSnapshot().sessions).toEqual([materialized]);
    expect(store.getSnapshot().activeId).toBe(id);
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
    expect((mocks.storage["sessions.local-meta"] as Record<string, unknown>)?.["dsh-1"]).not.toHaveProperty("archived");
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
