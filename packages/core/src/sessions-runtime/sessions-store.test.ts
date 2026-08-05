import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_META_KEY } from "../sessions";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  storageSet: vi.fn(),
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
  ensureHermesSession: vi.fn(async () => ({ ok: true })),
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
});
