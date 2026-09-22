import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
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
