import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_META_KEY } from "../sessions";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  storageSet: vi.fn(),
  ensureHermesSession: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@amiba/platform", () => ({
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
        mocks.storageSet(patch);
      },
      remove: async () => {},
      watch: () => () => {},
    },
    runtime: { sendMessage: async () => undefined },
  }),
}));

vi.mock("../hermes-profiles", () => ({
  getHermesProfiles: async () => ({
    ok: true,
    active: "default",
    profiles: [{ name: "default" }],
  }),
}));

vi.mock("../hermes-sessions", () => ({
  appendHermesMessage: vi.fn(async () => ({ ok: true })),
  createHermesSession: vi.fn(async () => ({ ok: true })),
  deleteHermesSession: vi.fn(async () => ({ ok: true })),
  ensureHermesSession: mocks.ensureHermesSession,
  forgetEnsuredHermesSession: vi.fn(),
  getHermesMessages: vi.fn(async () => ({ ok: true, messages: [] })),
  listHermesSessions: vi.fn(async () => ({
    ok: true,
    sessions: [
      {
        id: "session-1",
        title: "Background task",
        source: "api_server",
        started_at: 1,
        last_active: 2,
        message_count: 2,
      },
    ],
  })),
  secToMs: (seconds: number) => seconds * 1000,
  updateHermesSession: vi.fn(async () => ({ ok: true })),
}));

import { SessionsStore } from "./sessions-store";

describe("SessionsStore unread state", () => {
  beforeEach(() => {
    mocks.storage = {
      "sessions.migrated.hermes": true,
      [LOCAL_META_KEY]: {},
    };
    mocks.storageSet.mockClear();
    mocks.ensureHermesSession.mockReset();
    mocks.ensureHermesSession.mockResolvedValue({ ok: true });
  });

  it("persists a background marker and clears it when the session opens", async () => {
    const store = new SessionsStore();
    await store.markUnread("session-1");
    expect(store.getSnapshot().ready).toBe(true);
    expect(store.getSnapshot().sessions[0].unread).toBe(true);
    expect(
      (mocks.storage[LOCAL_META_KEY] as Record<string, { unread?: boolean }>)[
        "session-1"
      ].unread,
    ).toBe(true);

    await store.openTab("session-1");
    expect(store.getSnapshot().sessions[0].unread).toBeUndefined();
    expect(
      (mocks.storage[LOCAL_META_KEY] as Record<string, { unread?: boolean }>)[
        "session-1"
      ].unread,
    ).toBeUndefined();

    store.teardown();
  });

  it("allows response-mode changes but rejects Profile changes after messages", async () => {
    const store = new SessionsStore();
    await store.markUnread("session-1");

    await store.setAgentContext("session-1", {
      profileId: "default",
      personality: { key: "concise", prompt: "Answer concisely." },
    });
    expect(store.getSnapshot().sessions[0].agent).toEqual({
      profileId: "default",
      personality: { key: "concise", prompt: "Answer concisely." },
    });

    await store.setAgentContext("session-1", {
      profileId: "researcher",
      personality: { key: "technical", prompt: "Be technical." },
    });
    expect(store.getSnapshot().sessions[0].agent).toEqual({
      profileId: "default",
      personality: { key: "concise", prompt: "Answer concisely." },
    });

    store.teardown();
  });

  it("publishes the empty state before outgoing persistence finishes", async () => {
    const store = new SessionsStore();
    await store.markUnread("session-1");
    await store.openTab("session-1");

    let finishEnsure!: (value: { ok: true }) => void;
    mocks.ensureHermesSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishEnsure = resolve;
        }),
    );

    const pendingDeselect = store.deselect();

    expect(store.getSnapshot().activeId).toBe("");
    expect(store.getSnapshot().activeMessages).toEqual([]);

    finishEnsure({ ok: true });
    await pendingDeselect;
    store.teardown();
  });
});
