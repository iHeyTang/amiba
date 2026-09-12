import { expect, it } from "vitest";
import type { AssistantTimelineItem } from "../protocol";
import { appendAssistantText, applyAssistantTextSource } from "./assistant-text-source";
import { DshAmibaEventBridge } from "./amiba-event-bridge";

it("attributes exact step ranges without splitting merged text or changing old snapshots", () => {
  const timeline:AssistantTimelineItem[]=[];
  appendAssistantText(timeline,"same.txt ",()=>"one",1);
  const snapshot=structuredClone(timeline);
  const oldRanges=(timeline[0] as any).sourceRanges;
  appendAssistantText(timeline,"same.txt",()=>"two",2);
  applyAssistantTextSource(timeline,{kind:"assistantTextSource",phase:"final",runtimeStep:2,runtimeSeq:91,text:"same.txt"});
  expect(timeline).toHaveLength(1);
  expect((timeline[0] as any).text).toBe("same.txt same.txt");
  expect((timeline[0] as any).sourceRanges).toEqual([
    {start:0,end:9,runtimeStep:1},
    {start:9,end:17,runtimeStep:2,runtimeSeq:91},
  ]);
  expect(oldRanges).toEqual((snapshot[0] as any).sourceRanges);
});
it("retires retry provenance while keeping previously visible text", () => {
  const timeline:AssistantTimelineItem[]=[];
  appendAssistantText(timeline,"same",()=>"one",1);
  applyAssistantTextSource(timeline,{kind:"assistantTextSource",phase:"reset",runtimeStep:1});
  appendAssistantText(timeline,"same",()=>"two",1);
  applyAssistantTextSource(timeline,{kind:"assistantTextSource",phase:"final",runtimeStep:1,runtimeSeq:40,text:"same"});
  expect((timeline[0] as any).text).toBe("samesame");
  expect((timeline[0] as any).sourceRanges).toEqual([{start:4,end:8,runtimeStep:1,runtimeSeq:40}]);
});
it("declines missing or mismatched text rather than guessing a sequence", () => {
  const timeline:AssistantTimelineItem[]=[];
  appendAssistantText(timeline,"unknown",()=>"one");
  appendAssistantText(timeline,"partial",()=>"two",1);
  applyAssistantTextSource(timeline,{kind:"assistantTextSource",phase:"final",runtimeStep:1,runtimeSeq:3,text:"different"});
  expect((timeline[0] as any).sourceRanges).toEqual([{start:7,end:14,runtimeStep:1}]);
  expect((timeline[0] as any).text).toBe("unknownpartial");
});
it("joins the same step across intervening reasoning without attributing the reasoning", () => {
  const timeline:AssistantTimelineItem[]=[];
  appendAssistantText(timeline,"left",()=>"one",2);
  timeline.push({kind:"reasoning",id:"reasoning",text:"thought"});
  appendAssistantText(timeline,"right",()=>"two",2);
  applyAssistantTextSource(timeline,{kind:"assistantTextSource",phase:"final",runtimeStep:2,runtimeSeq:99,text:"leftright"});
  expect((timeline[0] as any).sourceRanges[0].runtimeSeq).toBe(99);
  expect((timeline[2] as any).sourceRanges[0].runtimeSeq).toBe(99);
  expect(timeline[1]).toEqual({kind:"reasoning",id:"reasoning",text:"thought"});
});
it("projects actual chunk, retry and append-finalization events with no seq fallback", () => {
  const bridge=new DshAmibaEventBridge();let seq=0;
  const send=(type:string,data:any,surfaceOp?:string)=>bridge.accept({rpcId:"r",payload:{type:"session/event",sessionId:"s",event:{type,seq:seq++,time:0,data,...(surfaceOp?{surfaceOp}:{})}}} as any).map(row=>row.event);
  expect(send("assistant/chunk",{step:3,chunk:{type:"text-delta",text:"hello"}})).toEqual([{kind:"chunk",text:"hello",runtimeStep:3}]);
  expect(send("llm/retry",{step:3})).toEqual([{kind:"assistantTextSource",phase:"reset",runtimeStep:3}]);
  expect(send("assistant/message",{step:3,message:{content:[{type:"text",text:"final"},{type:"reasoning",text:"private"}]}},"append")).toEqual([{kind:"assistantTextSource",phase:"final",runtimeStep:3,runtimeSeq:2,text:"final"}]);
  expect(send("assistant/message",{step:3,message:{content:[]}})).toEqual([]);
  expect(send("assistant/message",{message:{content:[]}},"append")).toEqual([]);
});

it("does not extend an existing history attribution into later chunks", () => {
  const timeline:AssistantTimelineItem[]=[{kind:"text",id:"history",text:"old",runtimeSeq:9}];
  appendAssistantText(timeline,"new",()=>"unused",2);
  expect(timeline[0]).toEqual({kind:"text",id:"history",text:"oldnew",sourceRanges:[{start:0,end:3,runtimeSeq:9},{start:3,end:6,runtimeStep:2}]});
});
it("revokes a previous same-step finalization if a newer final text disagrees", () => {
  const timeline:AssistantTimelineItem[]=[];
  appendAssistantText(timeline,"text",()=>"one",1);
  applyAssistantTextSource(timeline,{kind:"assistantTextSource",phase:"final",runtimeStep:1,runtimeSeq:3,text:"text"});
  const previous=(timeline[0] as any).sourceRanges;
  applyAssistantTextSource(timeline,{kind:"assistantTextSource",phase:"final",runtimeStep:1,runtimeSeq:4,text:"corrected"});
  expect((timeline[0] as any).sourceRanges).toEqual([{start:0,end:4,runtimeStep:1}]);
  expect(previous).toEqual([{start:0,end:4,runtimeStep:1,runtimeSeq:3}]);
});
