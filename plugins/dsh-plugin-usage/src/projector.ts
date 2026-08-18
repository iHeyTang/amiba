import type { SessionEvent } from "@deepseek-ai/dsh-session";

import type { AmibaUsageRecord } from "./remote.js";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function eventTimestamp(value: number): number {
  return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function usageRecord(
  event: SessionEvent,
  sessionId: string,
  route: { provider: string; model: string },
  usage: unknown,
): AmibaUsageRecord | undefined {
  const data = recordValue(event.data);
  const value = recordValue(usage);
  const turn = nonnegativeInteger(data?.turn);
  const step = nonnegativeInteger(data?.step);
  const input = nonnegativeInteger(value?.inputTokens);
  const output = nonnegativeInteger(value?.outputTokens);
  if (turn === undefined || step === undefined || input === undefined || output === undefined) {
    return undefined;
  }
  return {
    ts: eventTimestamp(event.time),
    sessionId,
    turn,
    step,
    provider: route.provider,
    model: route.model,
    uncachedInputTokens: input,
    cacheReadTokens: nonnegativeInteger(value?.cacheReadTokens) ?? 0,
    cacheWriteTokens: nonnegativeInteger(value?.cacheWriteTokens) ?? 0,
    outputTokens: output,
  };
}

/** Mirror dsh-token-meter's last-sample-wins rule for each turn/step. */
export function projectDshUsage(
  sessionId: string,
  events: readonly SessionEvent[],
): AmibaUsageRecord[] {
  let route = { provider: "", model: "" };
  const byStep = new Map<string, AmibaUsageRecord>();
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    const data = recordValue(event.data);
    if (event.type === "request/header") {
      const header = recordValue(data?.header);
      const config = recordValue(header?.config);
      if (typeof config?.provider === "string" && typeof config.model === "string") {
        route = { provider: config.provider, model: config.model };
      }
      continue;
    }
    if (event.type === "request/context") {
      if (typeof data?.provider === "string" && typeof data.model === "string") {
        route = { provider: data.provider, model: data.model };
      }
      continue;
    }

    let usage: unknown;
    if (event.type === "assistant/chunk") {
      const chunk = recordValue(data?.chunk);
      if (chunk?.type === "usage") usage = chunk.usage;
    } else if (event.type === "assistant/message") {
      usage = data?.usage;
    }
    const record = usageRecord(event, sessionId, route, usage);
    if (record) byStep.set(`${record.turn}:${record.step}`, record);
  }
  return [...byStep.values()].sort((left, right) => right.ts - left.ts);
}
