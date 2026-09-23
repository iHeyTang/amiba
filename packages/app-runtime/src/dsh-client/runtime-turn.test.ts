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


it("retains each finalized text's exact sequence inside a merged history bubble", () => {
  const source=[
    event("turn/start",100,7),
    event("assistant/message",104,7,{message:{id:"first",content:[{type:"text",text:"first `report.txt`"}]}}),
    event("assistant/message",119,7,{step:2,message:{id:"closing",content:[{type:"text",text:"last `report.txt`"}]}}),
    event("turn/end",125,7,{reason:{kind:"completed"}}),
  ];
  const history=projectRuntimeSessionHistory(source.map(event=>({event})));
  const assistant=history.find(row=>row.role==="assistant")!;
  expect(assistant.content).toBe("first `report.txt`last `report.txt`");
  expect(assistant.assistantMessageId).toBe("closing");
  expect(assistant.assistantTimeline?.filter(item=>item.kind==="text")).toEqual([
    {kind:"text",id:"dsh:text:104",text:"first `report.txt`",runtimeSeq:104},
    {kind:"text",id:"dsh:text:119",text:"last `report.txt`",runtimeSeq:119},
  ]);
});

it("restores draft provenance without changing the historical body or timeline", () => {
  const source=[event("turn/start",1,7),
    event("assistant/chunk",2,7,{chunk:{type:"text-delta",index:0,text:"old "}}),
    event("llm/retry",3,7),
    event("assistant/chunk",4,7,{chunk:{type:"text-delta",index:0,text:"new `file.txt`"}}),
    event("assistant/chunk",5,7,{chunk:{type:"reasoning-delta",index:1,text:"thought"}}),
    event("turn/end",6,7,{reason:{kind:"blocked"}})];
  const row=projectRuntimeSessionHistory(source.map(event=>({event})))[0]!;
  expect(row.content).toBe("old new `file.txt`");
  expect(row.assistantTimeline?.map(item=>item.kind)).toEqual(["reasoning"]);
  expect(row.assistantDraftSource).toEqual({kind:"text",id:"dsh:turn:1:text-tail",text:row.content,sourceRanges:[{start:4,end:18,runtimeStep:1}]});
  const finalized=projectRuntimeSessionHistory([...source.slice(0,-1),event("assistant/message",6,7,{message:{id:"final",content:[{type:"text",text:"final"}]}}),source.at(-1)!].map(event=>({event})))[0]!;
  expect(finalized.content).toBe("final");
  expect(finalized.assistantDraftSource).toBeUndefined();
});

it("preserves the durable completion time in live events and restored history", () => {
  const source = [event("turn/start", 10, 7), event("assistant/message", 20, 7, { message: { id: "answer", content: [{ type: "text", text: "done" }] } }), event("turn/end", 30, 7)];
  source[2].time = 1750000000123;
  const bridge = new DshAmibaEventBridge();
  const live = source.flatMap(event => bridge.accept({ rpcId: "rpc", payload: { type: "session/event", sessionId: "s", event } } as any));
  expect(live.find(row => row.event.kind === "assistantMessage")?.event).toMatchObject({ sentAt: 1750000000123 });
  expect(projectRuntimeSessionHistory(source.map(event => ({ event }))).find(row => row.role === "assistant")?.sentAt).toBe(1750000000123);
  expect(projectRuntimeSessionHistory(source.slice(0, 2).map(event => ({ event }))).find(row => row.role === "assistant")?.sentAt).toBe(20);
});
