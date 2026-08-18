import type { AgentUsageAdapter, AgentUsageRecord } from "@amiba/app-runtime/platform";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-session-query";

import { projectDshUsage } from "./projector.js";

const HISTORY_CONCURRENCY = 4;

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= values.length) return;
        result[index] = await mapper(values[index]!);
      }
    }),
  );
  return result;
}

export class DshUsageReader {
  private inFlight: ReturnType<AgentUsageAdapter["list"]> | null = null;

  constructor(private readonly ctx: Context) {}

  list(): ReturnType<AgentUsageAdapter["list"]> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.read().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async read() {
    const sessions = await this.ctx.sessionQuery.listSessions();
    const rows = await mapConcurrent(sessions, HISTORY_CONCURRENCY, async (session) => {
      const sessionId = String(session.header.id);
      try {
        const snapshot = await this.ctx.sessionQuery.readSession(session.header.id);
        return {
          records: projectDshUsage(sessionId, snapshot.events),
        };
      } catch (cause) {
        return {
          records: [] as AgentUsageRecord[],
          failure: {
            sessionId,
            message: cause instanceof Error ? cause.message : String(cause),
          },
        };
      }
    });
    return {
      records: rows.flatMap((row) => row.records).sort((left, right) => right.ts - left.ts),
      failures: rows.flatMap((row) => row.failure ? [row.failure] : []),
    };
  }
}
