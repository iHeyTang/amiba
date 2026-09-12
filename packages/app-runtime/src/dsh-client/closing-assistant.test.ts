import { describe, expect, it } from "vitest";
import type { DshSessionEvent } from "./index";
import { DshAmibaEventBridge } from "./amiba-event-bridge";
import { projectRuntimeSessionHistory } from "../core/runtime-session-history";

const event = (type: string, seq: number, data: Record<string, unknown> = {}): DshSessionEvent =>
  ({ type, seq, data: { turn: 1, step: 1, ...data }, time: seq, surfaceOp: "append" });
const message = (seq: number, id: string, text: string, step = 1) =>
  event("assistant/message", seq, { step, message: { id, content: [{ type: "text", text }] } });
const chunk = (seq: number, text: string, step = 1) =>
  event("assistant/chunk", seq, { step, chunk: { type: "text-delta", index: 0, text } });
const end = (seq = 100) => event("turn/end", seq, { reason: { kind: "completed" } });
const history = (events: DshSessionEvent[]) => projectRuntimeSessionHistory(events.map(event => ({ event })))
  .findLast(row => row.role === "assistant")?.assistantMessageId;
const live = (events: DshSessionEvent[]) => {
  const bridge = new DshAmibaEventBridge();
  return events.flatMap(event => bridge.accept({rpcId:"rpc", payload:{type:"session/event",sessionId:"session",event}}))
    .map(row => row.event).findLast(event => event.kind === "assistantMessage")?.messageId;
};

describe.each([["live", live], ["history", history]] as const)("%s assistant action identity", (_name, target) => {
  it("selects the last finalized prose step, not the bubble or tool-only message", () => {
    expect(target([message(1,"first","first answer"), message(2,"last","final answer",2), message(3,"tool-only","",3),end()])).toBe("last");
  });
  it("does not publish actions before turn completion", () => {
    expect(target([message(1,"first","answer")])).toBeUndefined();
  });
  it("suppresses an earlier id when a later prose step was interrupted", () => {
    expect(target([message(1,"first","answer"),chunk(2,"unfinished",2),end()])).toBeUndefined();
  });
  it("keeps earlier prose identity when a later step contains only reasoning", () => {
    expect(target([message(1,"first","answer"),event("assistant/chunk",2,{step:2,chunk:{type:"reasoning-delta",index:0,text:"thinking"}}),end()])).toBe("first");
  });
  it("discards a retried draft and uses the replacement completion", () => {
    expect(target([message(1,"discarded","wrong"),event("llm/retry",2),message(3,"replacement","correct"),end()])).toBe("replacement");
    expect(target([message(1,"discarded","wrong"),event("llm/retry",2),end()])).toBeUndefined();
  });
  it("excludes replacement-surface copies from identity selection", () => {
    expect(target([message(1,"original","answer"),{...message(2,"copy","copy"),surfaceOp:"replace"},end()])).toBe("original");
  });
  it("tracks completed text blocks and closes their actual step boundary", () => {
    expect(target([event("assistant/chunk",1,{chunk:{type:"block-end",index:0,block:{type:"text",text:"partial"}}}),event("step/end",2),message(3,"final","final",2),end()])).toBe("final");
  });
  it("accepts an interrupted but durable assistant message id", () => {
    const final=message(2,"durable","partial");final.data.interrupted=true;
    expect(target([chunk(1,"partial"),final,end()])).toBe("durable");
  });
});
