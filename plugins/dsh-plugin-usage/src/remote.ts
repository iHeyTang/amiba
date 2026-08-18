import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

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

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaUsage: {
      list(): Promise<RemoteResult<AmibaUsageListResult>>;
    };
  }

  interface TypertRemoteMap {
    "amibaUsage/list": () => Promise<RemoteResult<AmibaUsageListResult>>;
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
  ],
};
