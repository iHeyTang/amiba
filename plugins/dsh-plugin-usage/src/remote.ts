import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type { ToolActivityReadResult } from "./tool-activity.js";

/** Provider-reported DSH usage, deduplicated at the canonical turn/step
 *  seam. Owned by this plugin — the platform contract carries no shape
 *  types for domain concepts, only the mechanism (Typert Remote). */
export interface AmibaUsageRecord {
  ts: number;
  sessionId: string;
  turn: number;
  step: number;
  provider: string;
  model: string;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface AmibaUsageFailure {
  sessionId: string;
  message: string;
}

export interface AmibaUsageListResult {
  records: AmibaUsageRecord[];
  failures: AmibaUsageFailure[];
}

const usageRecordSchema = z.object({
  ts: z.number(),
  sessionId: z.string(),
  turn: z.number(),
  step: z.number(),
  provider: z.string(),
  model: z.string(),
  uncachedInputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  outputTokens: z.number(),
});

const usageFailureSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
});

const usageListResultSchema = z.object({
  records: z.array(usageRecordSchema),
  failures: z.array(usageFailureSchema),
});

const toolInvocationSchema = z.object({
  ts: z.number(),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  tool: z.string(),
  toolCallId: z.string(),
  durationMs: z.number().optional(),
  completed: z.boolean(),
});

const toolActivityTotalsSchema = z.object({
  calls: z.number(),
  distinctTools: z.number(),
  totalDurationMs: z.number(),
  unfinished: z.number(),
});

const toolActivityReadResultSchema = z.object({
  days: z.array(
    z.object({
      day: z.string(),
      rows: z.array(toolInvocationSchema),
    }),
  ),
  lifetime: toolActivityTotalsSchema,
});

const numberCodec = {
  mode: "strict" as const,
  typeSymbol: "typescript#number",
  schema: z.number(),
};

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaUsage: {
      list(): Promise<RemoteResult<AmibaUsageListResult>>;
      readToolActivity(
        days: number,
      ): Promise<RemoteResult<ToolActivityReadResult>>;
    };
  }

  interface TypertRemoteMap {
    "amibaUsage/list": () => Promise<RemoteResult<AmibaUsageListResult>>;
    "amibaUsage/readToolActivity": (
      days: number,
    ) => Promise<RemoteResult<ToolActivityReadResult>>;
  }
}

/** Strict Client descriptor for the plugin's DSH Typert Remote face. */
export const AMIBA_USAGE_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-usage",
  descriptors: [
    {
      id: "@amiba/dsh-plugin-usage#amibaUsage/list",
      service: "amibaUsage",
      namespace: "amibaUsage",
      method: "list",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dsh-plugin-usage#AmibaUsageListResult",
        schema: usageListResultSchema,
      },
    },
    {
      id: "@amiba/dsh-plugin-usage#amibaUsage/readToolActivity",
      service: "amibaUsage",
      namespace: "amibaUsage",
      method: "readToolActivity",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "days",
          wire: "days",
          source: "json",
          codec: numberCodec,
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "@amiba/dsh-plugin-usage#ToolActivityReadResult",
        schema: toolActivityReadResultSchema,
      },
    },
  ],
};
