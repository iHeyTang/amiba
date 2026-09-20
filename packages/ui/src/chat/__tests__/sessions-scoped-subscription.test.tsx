/**
 * The React side of the scoped-subscription contract.
 *
 * `FullScreenChatView` (the window chrome) calls
 * `useSessions(SHELL_STATE_KEYS)` so that a streaming reply, which rewrites
 * `activeMessages` once per animation frame, does not re-render the sidebar
 * history list, the tab bar and the workbench. These cases pin the hook
 * wiring that makes that true — a subscription that silently fell back to
 * "every key", or that was torn down and rebuilt on each render, would give
 * the same jank back without failing any store-level test.
 */

import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import {
  SessionsProvider,
  SessionsStore,
  useSessions,
  type SessionsStateKey,
} from "@amiba/app-runtime/core";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** Mirrors `SHELL_STATE_KEYS` in `FullScreenChatView.tsx`. */
const SHELL_STATE_KEYS = [
  "sessionLoad",
  "ready",
  "sessions",
  "openTabIds",
  "activeId",
] as const satisfies readonly SessionsStateKey[];

const message = { uiId: "a1", role: "assistant" as const, content: "" };

beforeEach(() => {
  setPlatform({
    storage: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      watch: () => () => {},
    },
    agentSessions: {
      list: async () => [],
      search: async () => [],
      create: async () => ({ sessionId: "new" }),
      history: async () => ({ events: [], hasMore: false }),
      rename: async () => ({ title: "", seq: 0 }),
      fork: async () => ({ sessionId: "child" }),
    },
    agentWorkspaces: {
      list: async () => ({ items: [], archivedSessionIds: [] }),
      archiveSession: async () => ({ archivedSessionIds: [] }),
    },
  } as unknown as PlatformAdapter);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(store: SessionsStore, renders: () => void) {
  return renderHook(
    () => {
      renders();
      return useSessions(SHELL_STATE_KEYS);
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SessionsProvider store={store}>{children}</SessionsProvider>
      ),
    },
  );
}

it("does not re-render a shell subscriber when the stream buffer grows a message", () => {
  const store = new SessionsStore();
  const renders = vi.fn();
  mount(store, renders);
  renders.mockClear();

  act(() => {
    for (let i = 0; i < 3; i += 1) {
      store.setActiveMessages((prev) => [...prev, message]);
    }
  });

  expect(renders).not.toHaveBeenCalled();
  expect(store.getSnapshot().activeMessages).toHaveLength(3);
  store.teardown();
});

it("still re-renders a subscriber that asked for activeMessages", () => {
  const store = new SessionsStore();
  const renders = vi.fn();
  renderHook(
    () => {
      renders();
      return useSessions(["activeId", "activeMessages"]);
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SessionsProvider store={store}>{children}</SessionsProvider>
      ),
    },
  );
  renders.mockClear();

  act(() => {
    store.setActiveMessages((prev) => [...prev, message]);
  });

  expect(renders).toHaveBeenCalledTimes(1);
  store.teardown();
});

it("keeps one subscription across re-renders", () => {
  const store = new SessionsStore();
  const subscribeKeys = vi.spyOn(store, "subscribeKeys");
  const view = mount(store, () => {});

  view.rerender();
  view.rerender();

  // `useSyncExternalStore` must not see a new `subscribe` identity per render,
  // or it would re-subscribe (and React would re-render in a loop).
  expect(subscribeKeys).toHaveBeenCalledTimes(1);
  store.teardown();
});
