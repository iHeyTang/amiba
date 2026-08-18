import type { DshApiClient, DshMuxEnvelope } from "@amiba/app-runtime/dsh-client";

interface TelemetryEvent {
  event: "run.completed" | "tool.started" | "tool.completed";
  payload: unknown;
}

interface ToolStart {
  sessionId: string;
  runId: string;
  tool: string;
  toolCallId: string;
  startedAt: number;
}

interface UsageSample {
  provider?: string;
  model?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Project the process-wide DSH event firehose into desktop telemetry. */
export class DshTelemetryProjector {
  private readonly tools = new Map<string, ToolStart>();
  private readonly routes = new Map<string, { provider?: string; model?: string }>();
  private readonly usage = new Map<string, Map<number, Map<number, UsageSample>>>();

  accept(envelope: DshMuxEnvelope): TelemetryEvent[] {
    if (envelope.payload.type !== "session/event") return [];
    const { sessionId, event } = envelope.payload;
    const data = record(event.data);
    if (!data) return [];
    const turn = integer(data.turn);

    if (event.type === "request/header") {
      const header = record(data.header);
      const config = record(header?.config);
      this.setRoute(sessionId, config);
      return [];
    }
    if (event.type === "request/context") {
      this.setRoute(sessionId, data);
      return [];
    }
    if (event.type === "tool/call") {
      const callId = typeof data.callId === "string" ? data.callId : "";
      const tool = typeof data.name === "string" ? data.name : "tool";
      if (!callId || turn === undefined) return [];
      const start: ToolStart = {
        sessionId,
        runId: `${sessionId}:${turn}`,
        tool,
        toolCallId: callId,
        startedAt: event.time,
      };
      this.tools.set(`${sessionId}:${callId}`, start);
      return [{ event: "tool.started", payload: start }];
    }
    if (event.type === "tool/result") {
      const message = record(data.message);
      const callId =
        typeof message?.toolCallId === "string" ? message.toolCallId : "";
      if (!callId) return [];
      const key = `${sessionId}:${callId}`;
      const start = this.tools.get(key);
      this.tools.delete(key);
      return [
        {
          event: "tool.completed",
          payload: {
            sessionId,
            runId:
              start?.runId ??
              (turn === undefined ? undefined : `${sessionId}:${turn}`),
            tool: start?.tool ?? "tool",
            toolCallId: callId,
            startedAt: start?.startedAt,
            durationMs:
              start && event.time >= start.startedAt
                ? event.time - start.startedAt
                : undefined,
          },
        },
      ];
    }
    if (event.type === "assistant/message") {
      const step = integer(data.step);
      const usage = record(data.usage);
      const input = integer(usage?.inputTokens);
      const output = integer(usage?.outputTokens);
      if (
        turn === undefined ||
        step === undefined ||
        input === undefined ||
        output === undefined
      ) {
        return [];
      }
      const turns = this.usage.get(sessionId) ?? new Map();
      const steps = turns.get(turn) ?? new Map();
      const route = this.routes.get(sessionId) ?? {};
      steps.set(step, {
        ...route,
        input,
        output,
        cacheRead: integer(usage?.cacheReadTokens) ?? 0,
        cacheWrite: integer(usage?.cacheWriteTokens) ?? 0,
      });
      turns.set(turn, steps);
      this.usage.set(sessionId, turns);
      return [];
    }
    if (event.type === "turn/end" && turn !== undefined) {
      const turns = this.usage.get(sessionId);
      const samples = [...(turns?.get(turn)?.values() ?? [])];
      turns?.delete(turn);
      if (turns?.size === 0) this.usage.delete(sessionId);
      if (samples.length === 0) return [];
      const promptTokens = samples.reduce(
        (sum, sample) =>
          sum + sample.input + sample.cacheRead + sample.cacheWrite,
        0,
      );
      const completionTokens = samples.reduce(
        (sum, sample) => sum + sample.output,
        0,
      );
      const route = samples.at(-1);
      return [
        {
          event: "run.completed",
          payload: {
            sessionId,
            model: route?.model,
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          },
        },
      ];
    }
    return [];
  }

  private setRoute(
    sessionId: string,
    value: Record<string, unknown> | undefined,
  ): void {
    const current = this.routes.get(sessionId) ?? {};
    this.routes.set(sessionId, {
      provider:
        typeof value?.provider === "string" ? value.provider : current.provider,
      model: typeof value?.model === "string" ? value.model : current.model,
    });
  }
}

let publish: (event: TelemetryEvent["event"], payload: unknown) => void = () => {};

export function setDshTelemetryPublisher(
  publisher: (event: TelemetryEvent["event"], payload: unknown) => void,
): void {
  publish = publisher;
}

export async function runDshTelemetryMonitor(
  client: Pick<DshApiClient, "events">,
  signal: AbortSignal,
): Promise<void> {
  const projector = new DshTelemetryProjector();
  for await (const envelope of client.events(signal)) {
    for (const item of projector.accept(envelope)) {
      publish(item.event, item.payload);
    }
  }
}
