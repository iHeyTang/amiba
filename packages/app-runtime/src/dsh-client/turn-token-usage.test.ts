import { expect, it } from "vitest";
import { TurnTokenUsage } from "./turn-token-usage";
it("deduplicates samples per step, aggregates all calls and resets turns", () => {
  const meter = new TurnTokenUsage();
  meter.apply({ type: "assistant/chunk", data: { turn: 1, step: 0, chunk: { type: "usage", usage: { inputTokens: 10, outputTokens: 1 } } } });
  meter.apply({ type: "assistant/message", data: { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 3 } } });
  meter.apply({ type: "assistant/message", data: { turn: 1, step: 1, usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 0 } } });
  expect(meter.snapshot()).toEqual({ inputTokens: 14, outputTokens: 7, cacheReadTokens: 28, cacheWriteTokens: 3 });
  meter.apply({ type: "turn/start", data: { turn: 2 } });
  expect(meter.snapshot()).toBeUndefined();
  meter.apply({ type: "assistant/message", data: { turn: 2, step: 0, usage: { inputTokens: 1, outputTokens: 2 } } });
  expect(meter.snapshot()).toEqual({ inputTokens: 1, outputTokens: 2 });
});
