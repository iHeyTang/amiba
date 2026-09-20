/**
 * Scoped-notification contract for ``SessionsStore``.
 *
 * ``activeMessages`` is rewritten once per animation frame while a reply
 * streams, while the rest of the snapshot only moves on user action. These
 * tests pin the behaviour that keeps the two apart: a listener registered
 * for the window chrome's keys must not be woken by the streaming buffer,
 * or every chunk re-renders the sidebar, the tab bar and the workbench —
 * which is what made switching sessions mid-stream feel frozen.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
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
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete mocks.storage[key];
        }
      },
      watch: () => () => {},
    },
    agentSessions: {
      list: async () => [
        {
          sessionId: "s1",
          updatedAt: 1,
          running: false,
          blank: false,
          title: "One",
          agentPreset: "standard",
        },
      ],
      search: async () => [],
      create: async () => ({ sessionId: "new" }),
      history: mocks.history,
      rename: async () => ({ title: "", seq: 0 }),
      fork: async () => ({ sessionId: "child" }),
    },
    agentWorkspaces: {
      list: async () => ({ items: [], archivedSessionIds: [] as string[] }),
      archiveSession: async () => {},
    },
  }),
}));

import { SessionsStore } from "./sessions-store";

/**
 * Mirrors ``SHELL_STATE_KEYS`` in
 * ``packages/ui/src/chat/FullScreenChatView.tsx``. Kept as a literal on
 * purpose: if the shell ever starts reading ``activeMessages`` this test
 * must fail loudly rather than silently follow the shell.
 */
const SHELL_STATE_KEYS = [
  "sessionLoad",
  "ready",
  "sessions",
  "openTabIds",
  "activeId",
] as const;

const assistantMessage = {
  uiId: "a1",
  role: "assistant" as const,
  content: "",
};

beforeEach(() => {
  mocks.storage = {};
  mocks.history.mockReset();
  mocks.history.mockResolvedValue({ events: [], hasMore: false });
});

describe("SessionsStore scoped notifications", () => {
  it("leaves a shell-scoped listener asleep while the stream buffer grows a message", () => {
    const store = new SessionsStore();
    const shell = vi.fn();
    store.subscribeKeys(SHELL_STATE_KEYS, shell);

    // Exactly what `useStreamBuffer` does on every animation frame of a reply.
    for (let i = 0; i < 5; i += 1) {
      store.setActiveMessages((prev) => [...prev, assistantMessage]);
    }

    expect(shell).not.toHaveBeenCalled();
    expect(store.getSnapshot().activeMessages).toHaveLength(5);
    store.teardown();
  });

  it("wakes a shell-scoped listener when a navigation slice changes", async () => {
    const store = new SessionsStore();
    await store.initialize();
    const shell = vi.fn();
    store.subscribeKeys(SHELL_STATE_KEYS, shell);

    await store.openTab("s1");

    expect(shell).toHaveBeenCalled();
    expect(store.getSnapshot().activeId).toBe("s1");
    store.teardown();
  });

  it("wakes a listener that includes activeMessages on a message change", () => {
    const store = new SessionsStore();
    const conversation = vi.fn();
    store.subscribeKeys(["activeId", "activeMessages"], conversation);

    store.setActiveMessages((prev) => [...prev, assistantMessage]);

    expect(conversation).toHaveBeenCalledTimes(1);
    store.teardown();
  });

  it("keeps the unscoped subscription as the wake-me-for-anything channel", () => {
    const store = new SessionsStore();
    const everything = vi.fn();
    store.subscribe(everything);

    store.setActiveMessages((prev) => [...prev, assistantMessage]);

    expect(everything).toHaveBeenCalledTimes(1);
    store.teardown();
  });

  it("treats a reference-equal commit as a no-op for every listener", () => {
    const store = new SessionsStore();
    const everything = vi.fn();
    const shell = vi.fn();
    store.subscribe(everything);
    store.subscribeKeys(SHELL_STATE_KEYS, shell);

    store.setActiveMessages((prev) => prev as typeof prev);

    expect(everything).not.toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();
    store.teardown();
  });

  it("stops notifying a listener after it unsubscribes", () => {
    const store = new SessionsStore();
    const everything = vi.fn();
    const off = store.subscribe(everything);

    store.setActiveMessages((prev) => [...prev, assistantMessage]);
    off();
    store.setActiveMessages((prev) => [...prev, assistantMessage]);

    expect(everything).toHaveBeenCalledTimes(1);
    store.teardown();
  });

  it("still hands a narrowed listener the latest full snapshot", () => {
    const store = new SessionsStore();
    const seen: unknown[] = [];
    store.subscribeKeys(["activeMessages"], () => {
      seen.push(store.getSnapshot().activeMessages);
    });

    store.setActiveMessages((prev) => [...prev, assistantMessage]);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(store.getSnapshot().activeMessages);
    store.teardown();
  });
});
