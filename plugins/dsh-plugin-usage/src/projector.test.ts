import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@deepseek-ai/dsh-session";

import { projectDshUsage } from "./projector.js";

function event(seq: number, type: string, data: Record<string, unknown>): SessionEvent {
  return { seq, type, time: 1_700_000_000 + seq, data } as SessionEvent;
}

describe("projectDshUsage", () => {
  it("keeps the last usage sample per turn and step with route attribution", () => {
    const records = projectDshUsage("session-1", [
      event(0, "request/context", { provider: "deepseek", model: "deepseek-chat" }),
      event(1, "assistant/chunk", {
        turn: 0,
        step: 0,
        chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
      }),
      event(2, "assistant/message", {
        turn: 0,
        step: 0,
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 3 },
      }),
    ]);
    expect(records).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        provider: "deepseek",
        model: "deepseek-chat",
        uncachedInputTokens: 10,
        cacheReadTokens: 3,
        outputTokens: 4,
      }),
    ]);
  });
});
