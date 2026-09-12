import { expect, it } from "vitest";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";

function event(type: string, seq: number, turn: unknown, extra = {}) {
  return { type, seq, time: seq, surfaceOp: "append", data: { ...(turn === undefined ? {} : { turn }), step: 1, ...extra } } as any;
}
for (const turn of [0, 7, 301]) {
  it(`preserves exact turn ${turn} in live and history, independently of sequence`, () => {
    const start = event("turn/start", 1000, turn);
    const bridge = new DshAmibaEventBridge();
    const live = bridge.accept({ rpcId: "rpc", payload: { type: "session/event", sessionId: "s", event: start } } as any);
    expect(live.find(row => row.event.kind === "turn")?.event).toMatchObject({ runtimeTurn: turn });
    const history = projectRuntimeSessionHistory([start,
      event("assistant/message", 1001, turn, { message: { id: "m", content: [{ type: "text", text: "answer" }] } }),
      event("turn/end", 1002, turn, { reason: { kind: "completed" } }),
    ].map(event => ({ event })));
    expect(history.find(row => row.role === "assistant")?.runtimeTurn).toBe(turn);
  });
}
it.each([undefined, -1, 1.5, "7"])("does not fabricate turn metadata from %s or event sequence", turn => {
  const start = event("turn/start", 1000, turn);
  const bridge = new DshAmibaEventBridge();
  const live = bridge.accept({ rpcId: "rpc", payload: { type: "session/event", sessionId: "s", event: start } } as any);
  expect(live.find(row => row.event.kind === "turn")?.event).not.toHaveProperty("runtimeTurn");
  const history = projectRuntimeSessionHistory([start, event("assistant/message", 1001, turn, { message: { content: [{ type: "text", text: "answer" }] } })].map(event => ({ event })));
  expect(history.find(row => row.role === "assistant")).not.toHaveProperty("runtimeTurn");
});
