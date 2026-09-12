// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TurnTail, turnTailOwner } from "./turn-tail";
afterEach(cleanup);
function fixture(closing: number | null = 12) {
  const data = {
    seq: 15,
    closing: closing === null ? null : { finalNode: { seq: closing } },
  };
  const turn = { turn: 7, status: "closed", data: { get: () => data } };
  const snapshot = {
    chat: { timeline: { turns: new Map([[7, turn]]) } },
  } as any;
  return { turn, snapshot };
}
it("forwards exact engine TurnLocation and closing anchor with the caller's opener", () => {
  const f = fixture(),
    openFile = vi.fn();
  const owner = turnTailOwner(f.snapshot, 7, openFile)!;
  expect(owner.turn).toBe(f.turn);
  expect(owner.seq).toBe(12);
  owner.openFile("relative/report.html");
  expect(openFile).toHaveBeenCalledWith("relative/report.html");
  expect(turnTailOwner(fixture(null).snapshot, 7, openFile)?.seq).toBe(15);
});
it("renders nothing for missing or open turns", () => {
  const f = fixture(),
    renderer = vi.fn(() => "tail");
  expect(turnTailOwner(f.snapshot, 1, vi.fn())).toBeNull();
  f.turn.status = "open";
  expect(turnTailOwner(f.snapshot, 7, vi.fn())).toBeNull();
  const { container } = render(
    <TurnTail runtimeTurn={7} openFile={vi.fn()} render={renderer} />,
  );
  expect(container.innerHTML).toBe("");
  expect(renderer).not.toHaveBeenCalled();
});
it("binds session methods and cleans up the old subscription on session changes", () => {
  const f = fixture(),
    listeners = new Set<() => void>();
  const source = {
    snapshot: f.snapshot,
    getSnapshot() {
      return this.snapshot;
    },
    subscribe(fn: () => void) {
      expect(this).toBe(source);
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  const { container, rerender, unmount } = render(
    <TurnTail
      source={source}
      runtimeTurn={7}
      openFile={vi.fn()}
      render={(owner) => `tail:${owner.seq}`}
    />,
  );
  expect(container.textContent).toBe("tail:12");
  expect(listeners.size).toBe(1);
  act(() => {
    source.snapshot = fixture(null).snapshot;
    for (const fn of listeners) fn();
  });
  expect(container.textContent).toBe("tail:15");
  rerender(
    <TurnTail
      runtimeTurn={7}
      openFile={vi.fn()}
      render={() => "wrong session"}
    />,
  );
  expect(listeners.size).toBe(0);
  expect(container.innerHTML).toBe("");
  unmount();
});
