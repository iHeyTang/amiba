import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStreamBuffer, type UseStreamBufferArgs } from "../useStreamBuffer";
import type { UiMessage } from "../types";

/**
 * Regression: DSH emits `reasoning-delta` chunks (true increments — the
 * history projection and chat engine both `+=` them). The stream buffer
 * must append too; assignment made the live thinking view show only the
 * latest fragment and the folded post-turn block collapse to the final
 * (often whitespace-only) delta.
 */
function makeSessionsStub() {
  let messages: UiMessage[] = [
    { uiId: "a1", role: "assistant", content: "" } as UiMessage,
  ];
  const setActiveMessages = vi.fn(
    (updater: UiMessage[] | ((prev: UiMessage[]) => UiMessage[])) => {
      messages =
        typeof updater === "function" ? updater(messages) : updater;
    },
  );
  return {
    stub: { setActiveMessages } as unknown as UseStreamBufferArgs["sessions"],
    current: () => messages,
  };
}

describe("useStreamBuffer reasoning accumulation", () => {
  it("appends reasoning deltas and keeps the full text on flush", () => {
    const { stub, current } = makeSessionsStub();
    const { result } = renderHook(() => useStreamBuffer({ sessions: stub }));
    act(() => {
      result.current.prime("a1");
      result.current.onReasoning("用户在");
      result.current.onReasoning("问候,");
      result.current.onReasoning("简单回复即可。");
      result.current.applyVerboseToAssistant();
    });
    expect(current()[0].reasoning).toBe("用户在问候,简单回复即可。");
  });

  it("keeps accumulated reasoning available for the done-path flush", () => {
    const { stub, current } = makeSessionsStub();
    const { result } = renderHook(() => useStreamBuffer({ sessions: stub }));
    act(() => {
      result.current.prime("a1");
      result.current.onReasoning("long thought");
      // Trailing whitespace-only delta must not wipe the block.
      result.current.onReasoning("\n\n");
      result.current.applyVerboseToAssistant();
    });
    expect(current()[0].reasoning).toBe("long thought");
  });
});

it("starts a new reasoning segment after a tool even while streaming",()=>{
 const {stub,current}=makeSessionsStub();const {result}=renderHook(()=>useStreamBuffer({sessions:stub}));
 act(()=>{
  result.current.prime("a1");
  result.current.onReasoning("before ");result.current.onReasoning("tool");
  result.current.onToolProgress({tool:"bash",toolCallId:"c",status:"running"});
  result.current.onReasoning("after tool");result.current.applyVerboseToAssistant();
 });
 const timeline=current()[0].assistantTimeline!;
 expect(timeline.map(item=>item.kind)).toEqual(["reasoning","tool","reasoning"]);
 expect(timeline.filter(item=>item.kind==="reasoning").map(item=>item.text)).toEqual(["before tool","after tool"]);
});

it("does not mutate a published reasoning segment before the next flush",()=>{
 const {stub,current}=makeSessionsStub();const {result}=renderHook(()=>useStreamBuffer({sessions:stub}));
 act(()=>{result.current.prime("a1");result.current.onReasoning("first");result.current.applyVerboseToAssistant();});
 const published=current()[0].assistantTimeline![0];
 act(()=>result.current.onReasoning(" second"));
 expect(published).toMatchObject({kind:"reasoning",text:"first"});
 act(()=>result.current.applyVerboseToAssistant());
 expect(current()[0].assistantTimeline![0]).toMatchObject({kind:"reasoning",text:"first second"});
});


it("updates compaction in place without mutating published state and settles it before terminal flush", () => {
  const { stub, current } = makeSessionsStub();
  const { result } = renderHook(() => useStreamBuffer({ sessions: stub }));
  act(() => {
    result.current.prime("a1");
    result.current.onChunk("before");
    result.current.onCompaction({ compactionId: "c", status: "running" });
    result.current.applyVerboseToAssistant();
  });
  const published = current()[0].assistantTimeline![1];
  act(() => {
    result.current.onCompaction({ compactionId: "c", summary: "saved context" });
    result.current.onChunk("after");
    result.current.finishCompactions();
    result.current.applyVerboseToAssistant();
  });
  expect(published).toMatchObject({ compaction: { status: "running" } });
  expect(current()[0].assistantTimeline).toMatchObject([
    { kind: "text", text: "before" },
    { kind: "compaction", compaction: { status: "interrupted", summary: "saved context" } },
    { kind: "text", text: "after" },
  ]);
});
