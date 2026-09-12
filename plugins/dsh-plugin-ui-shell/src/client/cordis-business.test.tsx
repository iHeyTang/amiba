// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { CordisBusiness, cordisBusinessOwner, type CordisBusinessOwner } from "./cordis-business.js";
import type { ToolResultNode } from "@deepseek-ai/dsh-client-runtime/client";

const owner = { pluginId: "plugin", packageId: "package", pluginRunId: "run" } as CordisBusinessOwner;
function block(seq: number, callId = `call-${seq}`, meta = owner): ToolResultNode {
  return { kind: "tool-result", seq, time: seq, callId, call: { name: "cordis_run", argsRaw: "{}" }, callTime: 0,
    content: [], isError: false, meta, callView: null, resultView: null, subCalls: [] };
}

it("only mounts the latest successful package card for the exact loaded activation", () => {
  const first = block(1), next = block(2);
  const snapshot = { nodes: [first, next] };
  expect(cordisBusinessOwner(first, snapshot, [owner])).toBeUndefined();
  expect(cordisBusinessOwner(next, snapshot, [owner])).toEqual(owner);
  expect(cordisBusinessOwner(next, snapshot, [{ ...owner, pluginRunId: "another-run" as never }])).toBeUndefined();
  expect(cordisBusinessOwner(next, snapshot, [])).toBeUndefined();
  expect(cordisBusinessOwner(next, undefined, [owner])).toBeUndefined();
  expect(cordisBusinessOwner(next, { nodes: [] }, [owner])).toBeUndefined();
});

it("ignores failed later calls and finds nested successful calls without inventing identity", () => {
  const first = block(1), failed = { ...block(2), isError: true };
  const root = { ...block(3), call: { name: "code", argsRaw: "{}" }, subCalls: [first, failed] };
  expect(cordisBusinessOwner(first, { nodes: [root] }, [owner])).toEqual(owner);
  expect(cordisBusinessOwner(failed, { nodes: [root] }, [owner])).toBeUndefined();
  const malformed = { ...first, meta: { pluginId: "plugin" } };
  expect(cordisBusinessOwner(malformed, { nodes: [malformed] }, [owner])).toBeUndefined();
});

it("removes the business region on stop and cleans both live subscriptions", () => {
  function store<T>(value: T) {
    const listeners = new Set<() => void>();
    return { getSnapshot: () => value, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
      set(next: T) { value = next; for (const fn of listeners) fn(); }, listeners };
  }
  const tool = block(1);
  const source = store({ nodes: [tool] });
  const packages = store<readonly CordisBusinessOwner[]>([owner]);
  const { container, unmount } = render(<CordisBusiness owner={{ block: tool } as never} source={source as never} packages={packages} render={() => <button>business</button>} />);
  expect(container.querySelector("button")).not.toBeNull();
  act(() => packages.set([]));
  expect(container.innerHTML).toBe("");
  unmount();
  expect(source.listeners.size).toBe(0);
  expect(packages.listeners.size).toBe(0);
});
