import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  rename: vi.fn(),
  fork: vi.fn(),
  history: vi.fn(),
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
      remove: async () => {},
      watch: () => () => {},
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

  it("uses DSH seq values when forking from a user message", async () => {
    const store = new SessionsStore();
    await store.initialize();
    await expect(store.resolveUserMessageId("dsh-1", 0)).resolves.toBe(1);
    await store.branchSession("dsh-1", 1);
    expect(mocks.fork).toHaveBeenCalledWith("dsh-1", 1);
    store.teardown();
  });

  it("retries an auto-title that races DSH session creation", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.rename
      .mockRejectedValueOnce(
        Object.assign(new Error("not materialized yet"), {
          code: "session-not-found",
        }),
      )
      .mockResolvedValue({ title: "hello", seq: 1 });

    const store = new SessionsStore();
    await store.initialize();
    const id = await store.createNew();
    await store.touchSession(id, [{ role: "user", content: "hello" }]);
    await store.touchSession(id, [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);

    expect(mocks.rename).toHaveBeenCalledTimes(2);
    expect(mocks.rename).toHaveBeenLastCalledWith(id, "hello");
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
    store.teardown();
  });
});
