import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionLoadState } from "@amiba/app-runtime/core";
import { useDelayedSessionLoad } from "../use-delayed-session-load";
const loading: SessionLoadState = { sessionId: "one", status: "loading" };
const error: SessionLoadState = { sessionId: "one", status: "error", message: "unsupported" };
function setup(initial: SessionLoadState | undefined) {
  return renderHook(({ load }) => useDelayedSessionLoad(load), { initialProps: { load: initial } });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("shows loading only after 300 ms", () => {
  const view = setup(loading);
  act(() => vi.advanceTimersByTime(299));
  expect(view.result.current).toBeUndefined();
  act(() => vi.advanceTimersByTime(1));
  expect(view.result.current).toEqual(loading);
});
it.each([undefined, error])("fast completion never shows loading: %j", result => {
  const view = setup(loading);
  act(() => vi.advanceTimersByTime(200));
  view.rerender({ load: result });
  expect(view.result.current).toEqual(result);
  act(() => vi.advanceTimersByTime(500));
  expect(view.result.current).toEqual(result);
});
it("retains the error panel during a fast retry", () => {
  const view = setup(error);
  view.rerender({ load: loading });
  act(() => vi.advanceTimersByTime(200));
  expect(view.result.current).toEqual(error);
  view.rerender({ load: { ...error, message: "still unsupported" } });
  act(() => vi.advanceTimersByTime(500));
  expect(view.result.current).toMatchObject({ message: "still unsupported" });
});
it("cancels the previous destination's timer", () => {
  const view = setup(loading);
  act(() => vi.advanceTimersByTime(200));
  const next: SessionLoadState = { sessionId: "two", status: "loading" };
  view.rerender({ load: next });
  act(() => vi.advanceTimersByTime(299));
  expect(view.result.current).toBeUndefined();
  act(() => vi.advanceTimersByTime(1));
  expect(view.result.current).toEqual(next);
  view.rerender({ load: undefined });
  expect(view.result.current).toBeUndefined();
});
