import { describe, expect, it } from "vitest";
import { CodeDispatchTree } from "./code-dispatch-tree";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";
import type { DshSessionEvent } from "./index";
import type { ToolProgress } from "../protocol";

const event = (
  type: string,
  seq: number,
  data: Record<string, unknown>,
): DshSessionEvent => ({ type, seq, time: seq * 10, data });
const root = event("tool/call", 1, {
  callId: "root",
  name: "run_code",
  arguments: '{"code":"work()"}',
  turn: 1,
  step: 1,
});
const start = (seq: number, parent = "root", id = "child") =>
  event("tool/code-dispatch-start", seq, {
    parentCallId: parent,
    subCallId: id,
    name: "read_file",
    arguments: { path: "a.txt" },
  });
const done = (seq: number, parent = "root", id = "child") =>
  event("tool/code-dispatch", seq, {
    parentCallId: parent,
    subCallId: id,
    name: "read_file",
    arguments: { path: "a.txt" },
    content: [{ type: "text", text: "content" }],
    isError: true,
  });
function stream(
  bridge: DshAmibaEventBridge,
  events: DshSessionEvent[],
  sessionId = "a",
) {
  let last: ToolProgress | undefined;
  for (const item of events)
    for (const value of bridge.accept({
      rpcId: "rpc",
      payload: { type: "session/event", sessionId, event: item },
    })) {
      if (value.event.kind === "toolProgress") last = value.event.event;
    }
  return last;
}
const fold = (events: DshSessionEvent[]) =>
  projectRuntimeSessionHistory(events.map((item) => ({ event: item }))).find(
    (message) => message.role === "assistant",
  )?.toolProgress?.[0];

describe.each([
  [
    "live",
    (events: DshSessionEvent[]) => stream(new DshAmibaEventBridge(), events),
  ],
  ["history", fold],
] as const)("%s Code Dispatch compatibility", (_name, produce) => {
  it("retains nested calls, completion order and error content without changing the root tool", () => {
    const row = produce([
      root,
      start(2),
      start(3, "child", "nested"),
      done(4, "child", "nested"),
      done(5),
    ])!;
    expect(row.tool).toBe("run_code");
    expect(row.status).toBe("running");
    expect(row.args).toEqual({ code: "work()" });
    expect(row.wire?.subCalls).toEqual([
      expect.objectContaining({
        kind: "tool-result",
        callId: "child",
        callTime: 20,
        isError: true,
        content: [{ type: "text", text: "content" }],
        subCalls: [
          expect.objectContaining({
            callId: "nested",
            callTime: 30,
            isError: true,
            subCalls: [],
          }),
        ],
      }),
    ]);
  });
  it("retains result-only children without inventing their start time", () => {
    expect(produce([root, done(3)])?.wire?.subCalls).toEqual([
      expect.objectContaining({
        callId: "child",
        callTime: null,
        call: { name: "read_file", argsRaw: '{"path":"a.txt"}' },
      }),
    ]);
  });
  it("leaves native tools without dispatch events unchanged", () => {
    expect(produce([root])?.wire).not.toHaveProperty("subCalls");
  });
});

it("isolates identical call IDs in different sessions", () => {
  const bridge = new DshAmibaEventBridge();
  stream(bridge, [root], "a");
  stream(
    bridge,
    [{ ...root, data: { ...root.data, name: "other_tool" } }],
    "b",
  );
  expect(stream(bridge, [start(2)], "a")?.tool).toBe("run_code");
  expect(
    stream(bridge, [start(2, "root", "other-child")], "b")?.wire?.subCalls,
  ).toEqual([expect.objectContaining({ callId: "other-child" })]);
});

it("rejects cycles, changed parents and stale replays", () => {
  const tree = new CodeDispatchTree();
  expect(tree.apply(start(2))).toBe("root");
  expect(tree.apply(done(3))).toBe("root");
  expect(tree.apply(start(2))).toBeNull();
  expect(tree.apply(start(4, "child", "root"))).toBeNull();
  expect(tree.apply(start(5, "different", "child"))).toBeNull();
});
