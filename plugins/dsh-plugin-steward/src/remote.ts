import type { RemoteResult, TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { ConversationCadence, ConversationView } from "@amiba/dsh-plugin-session-features";

import type { AdoptResult, StewardTask } from "./types.js";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  origin: z.enum(["created", "adopted"]),
  status: z.enum(["idle", "running", "needs_input", "done", "failed"]),
  lastReportedSeq: z.number(),
  lastSummary: z.string().optional(),
  lastError: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const adoptResultSchema = z.union([
  z.object({ kind: z.literal("adopted"), task: taskSchema, existing: z.boolean() }),
  z.object({ kind: z.literal("candidates"), candidates: z.array(z.object({ sessionId: z.string(), title: z.string() })) }),
]);

const adoptInputSchema = z.object({ sessionId: z.string(), title: z.string().optional() });

const stringCodec = { mode: "strict" as const, typeSymbol: "typescript#string", schema: z.string() };
const booleanCodec = { mode: "strict" as const, typeSymbol: "typescript#boolean", schema: z.boolean() };
export type ConversationSettingsInput = { action: "status" | "configure" | "new"; cadence?: ConversationCadence };
const conversationSettingsInput = z.object({ action: z.enum(["status", "configure", "new"]), cadence: z.enum(["daily", "weekly", "manual"]).optional() });
const conversationViewSchema = z.object({
  policy: z.object({ cadence: z.enum(["daily", "weekly", "manual"]), timeZone: z.string() }),
  currentSessionId: z.string().optional(),
  pendingNewConversation: z.boolean(),
  history: z.array(z.object({ sessionId: z.string(), createdAt: z.number() })),
  sharedResources: z.array(z.object({ reference: z.string(), title: z.string() })),
});

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaSteward: {
      conversationSettings(input: ConversationSettingsInput): Promise<RemoteResult<ConversationView>>;
      ensureStewardSession(): Promise<RemoteResult<{ sessionId: string; sessionIds?: string[] }>>;
      listTasks(includeDone: boolean): Promise<RemoteResult<StewardTask[]>>;
      adopt(input: { sessionId: string; title?: string }): Promise<RemoteResult<AdoptResult>>;
      closeTask(id: string): Promise<RemoteResult<StewardTask>>;
    };
  }

  interface TypertRemoteMap {
    "amibaSteward/conversationSettings": (input: ConversationSettingsInput) => Promise<RemoteResult<ConversationView>>;
    "amibaSteward/ensureStewardSession": () => Promise<RemoteResult<{ sessionId: string; sessionIds?: string[] }>>;
    "amibaSteward/listTasks": (includeDone: boolean) => Promise<RemoteResult<StewardTask[]>>;
    "amibaSteward/adopt": (input: { sessionId: string; title?: string }) => Promise<RemoteResult<AdoptResult>>;
    "amibaSteward/closeTask": (id: string) => Promise<RemoteResult<StewardTask>>;
  }
}

function descriptor(
  method: string,
  parameters: TypertRemoteContribution["descriptors"][number]["parameters"],
  result: TypertRemoteContribution["descriptors"][number]["result"],
) {
  return {
    id: `@amiba/dsh-plugin-steward#amibaSteward/${method}`,
    service: "amibaSteward",
    namespace: "amibaSteward",
    method,
    invocation: { kind: "direct" as const },
    parameters,
    result,
  };
}

/** Strict DSH Remote contract consumed by the steward Client plugin. */
export const AMIBA_STEWARD_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-steward",
  descriptors: [
    descriptor("conversationSettings", [{ name: "input", wire: "input", source: "json", codec: { mode: "strict", typeSymbol: "@amiba/steward#conversation-settings-input", schema: conversationSettingsInput } }], {
      mode: "strict", typeSymbol: "@amiba/steward#conversation-view", schema: conversationViewSchema,
    }),
    descriptor("ensureStewardSession", [], {
      mode: "strict",
      typeSymbol: "@amiba/steward#session",
      schema: z.object({ sessionId: z.string(), sessionIds: z.array(z.string()).optional() }),
    }),
    descriptor(
      "listTasks",
      [{ name: "includeDone", wire: "includeDone", source: "json", codec: booleanCodec }],
      { mode: "strict", typeSymbol: "@amiba/steward#tasks", schema: z.array(taskSchema) },
    ),
    descriptor(
      "adopt",
      [{ name: "input", wire: "input", source: "json", codec: { mode: "strict", typeSymbol: "@amiba/steward#adopt-input", schema: adoptInputSchema } }],
      { mode: "strict", typeSymbol: "@amiba/steward#adopt-result", schema: adoptResultSchema },
    ),
    descriptor(
      "closeTask",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      { mode: "strict", typeSymbol: "@amiba/steward#task", schema: taskSchema },
    ),
  ],
};
