import type { DshSessionEvent } from "./index";

type Event = Pick<DshSessionEvent, "type" | "seq" | "data"> & { surfaceOp?: unknown };
type Step = {
  text: Map<number, string>;
  final?: { seq: number; messageId: string | null; hasText: boolean };
  end?: number;
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;

/**
 * The identity selected by rc.2's assistant-step + turn-tail projections.
 * Only identity is retained here; Amiba's existing text/bubble stays untouched.
 * A later interrupted prose step has no durable MessageId and suppresses actions.
 */
export class ClosingAssistant {
  private steps = new Map<number, Step>();
  private end: number | undefined;
  private revision = -1;

  apply(event: Event): void {
    if (event.seq <= this.revision) return;
    this.revision = event.seq;
    if (event.type === "turn/start") {
      this.steps.clear();
      this.end = undefined;
      return;
    }
    if (event.type === "turn/end") {
      this.end = event.seq;
      return;
    }
    if (!["step/start", "step/end", "assistant/chunk", "assistant/message", "llm/retry"].includes(event.type)) return;
    const key = event.data.step;
    if (typeof key !== "number") return;
    if (event.type === "assistant/message" && event.surfaceOp !== "append") return;
    let step = this.steps.get(key);
    if (!step) { step = { text: new Map() }; this.steps.set(key, step); }
    if (event.type === "llm/retry") {
      step.text.clear();
      delete step.final;
    } else if (event.type === "step/end") {
      step.end = event.seq;
    } else if (event.type === "assistant/message") {
      const message = record(event.data.message);
      step.final = {
        seq: event.seq,
        messageId: typeof message?.id === "string" ? message.id : null,
        hasText: Array.isArray(message?.content) && message.content.some(block => {
          const value = record(block);
          return value?.type === "text" && typeof value.text === "string" && !!value.text.trim();
        }),
      };
    } else if (event.type === "assistant/chunk") {
      const chunk = record(event.data.chunk);
      if (!chunk || typeof chunk.index !== "number") return;
      const index = chunk.index;
      if (chunk.type === "text-delta" && typeof chunk.text === "string") {
        step.text.set(index, (step.text.get(index) ?? "") + chunk.text);
      } else if (chunk.type === "block-start" || chunk.type === "reasoning-delta" || chunk.type === "tool-call-delta") {
        step.text.delete(index);
      } else if (chunk.type === "block-end") {
        const block = record(chunk.block);
        if (block?.type === "text" && typeof block.text === "string") step.text.set(index, block.text);
        else step.text.delete(index);
      }
    }
  }

  getMessageId(): string | null {
    if (this.end === undefined) return null;
    let closing: { seq: number; messageId: string | null } | undefined;
    for (const step of this.steps.values()) {
      const candidate = step.final
        ? step.final.hasText ? step.final : undefined
        : [...step.text.values()].some(text => !!text.trim())
          ? { seq: step.end ?? this.end, messageId: null }
          : undefined;
      if (candidate && (!closing || candidate.seq >= closing.seq)) closing = candidate;
    }
    return closing?.messageId ?? null;
  }
}
