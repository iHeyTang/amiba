// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { UseSessionPendingInteraction, SessionPendingInteractionSnapshot } from "@deepseek-ai/dsh-client-ui-session/client";
import { ComposerRegion } from "./composer-region.js";
import type { ConversationSource, ConversationSnapshot } from "./conversation-snapshot.js";

afterEach(cleanup);
it("forwards live official interaction state and refuses stale session snapshots", async () => {
  const listeners = new Set<() => void>();
  let session = { sessionId: "a" } as ConversationSnapshot;
  let interactions: SessionPendingInteractionSnapshot = new Map();
  const source = { getSnapshot: () => session, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } } satisfies Pick<ConversationSource, "subscribe" | "getSnapshot">;
  const usePending = ((selector: (state: SessionPendingInteractionSnapshot) => unknown) => selector(useSyncExternalStore(source.subscribe, () => interactions))) as UseSessionPendingInteraction;
  const dispatch = vi.fn(owner => <div>{owner.pendingInteraction?.key ?? "idle"}</div>);
  const view = render(<ComposerRegion sessionId="a" source={source} usePendingInteraction={usePending} fallback={<span>native</span>} render={dispatch} />);
  expect(screen.getByText("idle")).toBeTruthy();
  const interaction = { key: "question-a", kind: "fixture", sessionId: "a" } as never;
  await act(async () => { interactions = new Map([["a" as never, interaction]]); listeners.forEach(fn => fn()); });
  expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ sessionId: "a", session, pendingInteraction: interaction });
  expect(screen.getByText("question-a")).toBeTruthy();
  dispatch.mockClear();
  view.rerender(<ComposerRegion sessionId="b" source={source} usePendingInteraction={usePending} fallback={<span>native</span>} render={dispatch} />);
  expect(dispatch).not.toHaveBeenCalled();
  expect(screen.getByText("native")).toBeTruthy();
  await act(async () => { session = { sessionId: "b" } as ConversationSnapshot; listeners.forEach(fn => fn()); });
  expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({ sessionId: "b", session, pendingInteraction: undefined });
  view.unmount();
  expect(listeners.size).toBe(0);
});
