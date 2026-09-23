import type { MessageTokenUsage } from "../protocol";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

/** Last provider sample wins for each canonical turn/step, as in token-meter. */
export class TurnTokenUsage {
  private steps = new Map<string, MessageTokenUsage>();
  apply(event: { type: string; data: unknown }) {
    const data = record(event.data);
    const chunk = record(data?.chunk);
    if (event.type === "turn/start") this.steps.clear();
    const value = record(event.type === "assistant/message" ? data?.usage
      : event.type === "assistant/chunk" && chunk?.type === "usage" ? chunk.usage : undefined);
    const valid = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
    if (!data || !value || !valid(data.turn) || !valid(data.step) || !valid(value.inputTokens) || !valid(value.outputTokens)) return;
    this.steps.set(`${data.turn}:${data.step}`, {
      inputTokens: value.inputTokens, outputTokens: value.outputTokens,
      ...(valid(value.cacheReadTokens) ? { cacheReadTokens: value.cacheReadTokens } : {}),
      ...(valid(value.cacheWriteTokens) ? { cacheWriteTokens: value.cacheWriteTokens } : {}),
    });
  }
  snapshot(): MessageTokenUsage | undefined {
    const rows = [...this.steps.values()];
    if (!rows.length) return undefined;
    const sum = (key: keyof MessageTokenUsage) => rows.reduce((n, row) => n + (row[key] ?? 0), 0);
    return {
      inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"),
      ...(rows.every(row => row.cacheReadTokens !== undefined) ? { cacheReadTokens: sum("cacheReadTokens") } : {}),
      ...(rows.every(row => row.cacheWriteTokens !== undefined) ? { cacheWriteTokens: sum("cacheWriteTokens") } : {}),
    };
  }
}
