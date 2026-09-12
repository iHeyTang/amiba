// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationInputState, ConversationInputZoneOwner } from "@amiba/extension-sdk";
import { InputRegion } from "./input-region.js";
afterEach(cleanup);
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    set(next: T) { value = next; for (const listener of listeners) listener(); },
    count: () => listeners.size,
  };
}
const initial: ConversationInputState = { draft: "native", draftRev: 2, phase: "plain", imageIds: [], occurrences: [], queue: [] };
function session() { return { queue: [] } as unknown as ConversationInputZoneOwner["session"]; }

describe("official input region snapshot owners", () => {
  it("dispatches real owners and updates on native input and session changes", () => {
    const value = session();
    const source = store(value);
    const input = store<ConversationInputState | undefined>(initial);
    const occupant = vi.fn((owner: ConversationInputZoneOwner) => <span>{owner.input.draft}</span>);
    render(<InputRegion source={source} input={input} render={occupant}/>);
    expect(occupant.mock.calls.at(-1)![0].session).toBe(value);
    expect(occupant.mock.calls.at(-1)![0].input).toBe(initial);
    act(() => input.set({ ...initial, draft: "edited", phase: "submitting" }));
    expect(screen.getByText("edited")).toBeTruthy();
    const nextSession = session();
    act(() => source.set(nextSession));
    expect(occupant.mock.calls.at(-1)![0].session).toBe(nextSession);
    act(() => input.set(undefined));
    expect(screen.queryByText("edited")).toBeNull();
  });
  it("does not mount a region without both owners and ignores replaced sources", () => {
    const source = store(session());
    const input = store<ConversationInputState | undefined>(initial);
    const occupant = vi.fn((owner: ConversationInputZoneOwner) => <span>{owner.input.draft}</span>);
    const view = render(<InputRegion input={input} render={occupant}/>);
    expect(occupant).not.toHaveBeenCalled();
    view.rerender(<InputRegion source={source} render={occupant}/>);
    expect(occupant).not.toHaveBeenCalled();
    view.rerender(<InputRegion source={source} input={input} render={occupant}/>);
    const replacement = store<ConversationInputState | undefined>({ ...initial, draft: "new session" });
    view.rerender(<InputRegion source={source} input={replacement} render={occupant}/>);
    expect(input.count()).toBe(0);
    act(() => input.set({ ...initial, draft: "stale" }));
    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.getByText("new session")).toBeTruthy();
    view.unmount();
    expect(source.count() + replacement.count()).toBe(0);
  });
});
