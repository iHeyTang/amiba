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


it("flushes exact live text provenance and keeps previous published ranges unchanged", () => {
  const {stub,current}=makeSessionsStub();
  const {result}=renderHook(()=>useStreamBuffer({sessions:stub}));
  act(()=>{result.current.prime("a1");result.current.onChunk("report.txt",2);result.current.applyVerboseToAssistant();});
  const before=current()[0].assistantTimeline![0];
  act(()=>{
    result.current.onAssistantTextSource({kind:"assistantTextSource",phase:"final",runtimeStep:2,runtimeSeq:42,text:"report.txt"});
    result.current.applyVerboseToAssistant();
  });
  expect(before).toMatchObject({text:"report.txt",sourceRanges:[{start:0,end:10,runtimeStep:2}]});
  expect((before as any).sourceRanges[0]).not.toHaveProperty("runtimeSeq");
  expect(current()[0].assistantTimeline![0]).toMatchObject({text:"report.txt",sourceRanges:[{start:0,end:10,runtimeStep:2,runtimeSeq:42}]});
});


it("retains pending text, tool evidence and retry records when an error resets the stream", () => {
  const { stub, current } = makeSessionsStub();
  const { result } = renderHook(() => useStreamBuffer({ sessions: stub }));
  act(() => {
    result.current.prime("a1");
    result.current.onChunk("partial answer");
    result.current.onReasoning("retained thought");
    result.current.onToolProgress({tool:"bash",toolCallId:"c",status:"completed"});
    result.current.onRetry({id:"r:1",attempt:1,delayMs:500,startedAt:100,status:"waiting"});
    result.current.cancelStreamChunkFlush();
    result.current.applyVerboseToAssistant();
    result.current.cancelVerboseFlush();
    result.current.flushStreamChunksToMessages();
    result.current.reset();
  });
  expect(current()[0].content).toBe("partial answer");
  expect(current()[0].reasoning).toBe("retained thought");
  expect(current()[0].toolProgress).toHaveLength(1);
  expect(current()[0].assistantTimeline?.at(-1)).toMatchObject({kind:"retry",retry:{attempt:1}});
});

describe("useStreamBuffer coalesced flush", () => {
  // Deterministic RAF harness: the frame-gated scheduler flushes at most once
  // per two scheduled animation frames, so tests drive callbacks directly.
  function captureStreamScheduler() {
    const callbacks: Array<() => void> = [];
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (cb: FrameRequestCallback) => {
        callbacks.push(() => cb(0));
        return callbacks.length;
      },
    );
    const caf = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation(() => {});
    return {
      raf,
      caf,
      /** Run every scheduled frame until the queue drains. */
      frames: () => {
        let guard = 0;
        while (callbacks.length && guard++ < 20) {
          callbacks.splice(0).forEach((cb) => cb());
        }
        return guard;
      },
    };
  }

  it("commits chunk and verbose state in a single setActiveMessages call", () => {
    const { stub, current } = makeSessionsStub();
    const { result } = renderHook(() => useStreamBuffer({ sessions: stub }));
    const scheduler = captureStreamScheduler();
    try {
      act(() => {
        result.current.prime("a1");
        result.current.onChunk("hello ");
        result.current.onReasoning("thinking");
      });
      expect(stub.setActiveMessages).not.toHaveBeenCalled();
      act(() => scheduler.frames());
      // One commit for the chunk AND the reasoning, not two:
      expect(stub.setActiveMessages).toHaveBeenCalledTimes(1);
      expect(current()[0].content).toBe("hello ");
      expect(current()[0].reasoning).toBe("thinking");
    } finally {
      scheduler.raf.mockRestore();
      scheduler.caf.mockRestore();
    }
  });

  it("throttles to one flush per two frames and never drops the tail", () => {
    const { stub, current } = makeSessionsStub();
    const { result } = renderHook(() => useStreamBuffer({ sessions: stub }));
    const scheduler = captureStreamScheduler();
    try {
      act(() => {
        result.current.prime("a1");
        result.current.onChunk("a");
        result.current.onChunk("b");
      });
      // Two chunks buffered before the first flush: the frame gate only
      // commits on even frames, yet everything buffered lands in ONE commit.
      act(() => scheduler.frames());
      expect(stub.setActiveMessages).toHaveBeenCalledTimes(1);
      expect(current()[0].content).toBe("ab");

      // A later chunk needs two fresh frames before it is committed.
      act(() => result.current.onChunk("c"));
      act(() => scheduler.frames());
      expect(current()[0].content).toBe("abc");
      expect(stub.setActiveMessages).toHaveBeenCalledTimes(2);

      // Terminal flush drains anything left outside the scheduler.
      act(() => {
        result.current.onChunk("d");
        result.current.cancelStreamChunkFlush();
        result.current.flushStreamChunksToMessages();
      });
      expect(current()[0].content).toBe("abcd");
    } finally {
      scheduler.raf.mockRestore();
      scheduler.caf.mockRestore();
    }
  });

  it("keeps the imperative terminal flushes independent of the scheduler", () => {
    const { stub, current } = makeSessionsStub();
    const { result } = renderHook(() => useStreamBuffer({ sessions: stub }));
    const scheduler = captureStreamScheduler();
    try {
      act(() => {
        result.current.prime("a1");
        result.current.onChunk("x");
        result.current.applyVerboseToAssistant();
        result.current.cancelStreamChunkFlush();
        result.current.cancelVerboseFlush();
        result.current.flushStreamChunksToMessages();
        result.current.reset();
      });
      expect(current()[0].content).toBe("x");
    } finally {
      scheduler.raf.mockRestore();
      scheduler.caf.mockRestore();
    }
  });
});
