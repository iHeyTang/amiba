import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { MESSAGE_DOM_CAP, MESSAGE_TURN_WINDOW } from "../turn-window";
import { useConversationTurnWindow } from "../use-conversation-turn-window";

it("restores expanded history after a session switch and remount", () => {
  const one = {}, two = {};
  const hook = renderHook(({ id, scope }) => useConversationTurnWindow(id, scope), { initialProps: { id: "one", scope: one } });
  act(() => hook.result.current[1]());
  expect(hook.result.current[0]).toBe(48);
  hook.rerender({ id: "two", scope: two });
  expect(hook.result.current[0]).toBe(24);
  hook.unmount();
  const restored = renderHook(() => useConversationTurnWindow("one", one));
  expect(restored.result.current[0]).toBe(48);
});

it("keeps the earlier window mounted when background turns arrive", () => {
  const scope = {};
  const first = renderHook(() => useConversationTurnWindow("one", scope, 80));
  expect(first.result.current[0]).toBe(24);
  first.unmount();
  const reopened = renderHook(() => useConversationTurnWindow("one", scope, 85));
  expect(reopened.result.current[0]).toBe(29);
});

it("grows the message budget alongside the turn limit on expand", () => {
  const scope = {};
  const hook = renderHook(() => useConversationTurnWindow("one", scope));
  expect(hook.result.current[0]).toBe(MESSAGE_TURN_WINDOW);
  expect(hook.result.current[2]).toBe(MESSAGE_DOM_CAP);
  act(() => hook.result.current[1]());
  expect(hook.result.current[0]).toBe(MESSAGE_TURN_WINDOW * 2);
  expect(hook.result.current[2]).toBe(MESSAGE_DOM_CAP * 2);
});
