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
