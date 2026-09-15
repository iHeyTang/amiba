// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useTrajectoryInspection } from "./trajectory-inspection.js";

it("hands off exact call IDs and acknowledges only the request that was rendered", () => {
  const { result } = renderHook(() => useTrajectoryInspection("session", [{ id: "trajectory" }]));
  act(() => result.current.inspectCall!("nested-call"));
  expect(result.current.selection).toEqual({ sessionId: "session", id: "trajectory" });
  expect(result.current.owner.viewRequest).toEqual({ view: "trajectory", focus: "nested-call" });
  const oldAck = result.current.owner.completeViewRequest;
  act(() => result.current.inspectCall!("new-call"));
  act(oldAck);
  expect(result.current.owner.viewRequest).toEqual({ view: "trajectory", focus: "new-call" });
  act(result.current.owner.completeViewRequest);
  expect(result.current.owner.viewRequest).toBeNull();
  expect(result.current.selection?.id).toBe("trajectory");
  act(() => result.current.select(null));
  expect(result.current.selection).toBeNull();
});

it("withdraws unavailable views and rejects callbacks from an older session visit or plugin lifetime", () => {
  const { result, rerender } = renderHook(({ id, enabled }) => useTrajectoryInspection(id, enabled ? [{ id: "trajectory" }] : []), {
    initialProps: { id: "one", enabled: true },
  });
  const oldInspect = result.current.inspectCall!;
  act(() => oldInspect("call-one"));
  rerender({ id: "two", enabled: true });
  expect(result.current.selection).toBeNull();
  expect(result.current.owner.viewRequest).toBeNull();
  rerender({ id: "one", enabled: true });
  act(() => oldInspect("call-one"));
  expect(result.current.selection).toBeNull();
  const beforeUnload = result.current.inspectCall!;
  act(() => beforeUnload("current"));
  rerender({ id: "one", enabled: false });
  expect(result.current.inspectCall).toBeUndefined();
  expect(result.current.owner.viewRequest).toBeNull();
  expect(result.current.selection).toBeNull();
  rerender({ id: "one", enabled: true });
  act(() => beforeUnload("obsolete"));
  expect(result.current.selection).toBeNull();
});
