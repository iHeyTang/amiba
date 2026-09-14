import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type {
  ConversationCadence,
  ConversationView,
} from "@amiba/dsh-plugin-session-features";

import type { StewardInstance, StewardProfileInput } from "./registry-store.js";
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
  z.object({
    kind: z.literal("adopted"),
    task: taskSchema,
    existing: z.boolean(),
  }),
  z.object({
    kind: z.literal("candidates"),
    candidates: z.array(z.object({ sessionId: z.string(), title: z.string() })),
  }),
]);

const adoptInputSchema = z.object({
  stewardId: z.string(),
  sessionId: z.string(),
  title: z.string().optional(),
});

const stringCodec = {
  mode: "strict" as const,
  typeSymbol: "typescript#string",
  schema: z.string(),
};
export type ConversationSettingsInput = {
  stewardId: string;
  action: "status" | "configure" | "new";
  cadence?: ConversationCadence;
};
const conversationSettingsInput = z.object({
  stewardId: z.string(),
  action: z.enum(["status", "configure", "new"]),
  cadence: z.enum(["daily", "weekly", "manual"]).optional(),
});
const conversationViewSchema = z.object({
  policy: z.object({
    cadence: z.enum(["daily", "weekly", "manual"]),
    timeZone: z.string(),
  }),
  currentSessionId: z.string().optional(),
  pendingNewConversation: z.boolean(),
  history: z.array(z.object({ sessionId: z.string(), createdAt: z.number() })),
  sharedResources: z.array(
    z.object({ reference: z.string(), title: z.string() }),
  ),
});

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaSteward: {
      instances(): Promise<RemoteResult<StewardInstance[]>>;
      saveInstance(
        input: StewardProfileInput & { id?: string },
      ): Promise<RemoteResult<StewardInstance>>;
      deleteInstance(
        id: string,
      ): Promise<RemoteResult<{ id: string; deleted: boolean }>>;
      conversationSettings(
        input: ConversationSettingsInput,
      ): Promise<RemoteResult<ConversationView>>;
      ensureStewardSession(
        stewardId: string,
      ): Promise<RemoteResult<{ sessionId: string; sessionIds?: string[] }>>;
      listTasks(input: {
        stewardId: string;
        includeDone: boolean;
      }): Promise<RemoteResult<StewardTask[]>>;
      adopt(input: {
        stewardId: string;
        sessionId: string;
        title?: string;
      }): Promise<RemoteResult<AdoptResult>>;
      closeTask(input: {
        stewardId: string;
        id: string;
      }): Promise<RemoteResult<StewardTask>>;
    };
  }

  interface TypertRemoteMap {
    "amibaSteward/instances": () => Promise<RemoteResult<StewardInstance[]>>;
    "amibaSteward/saveInstance": (
      input: StewardProfileInput & { id?: string },
    ) => Promise<RemoteResult<StewardInstance>>;
    "amibaSteward/deleteInstance": (
      id: string,
    ) => Promise<RemoteResult<{ id: string; deleted: boolean }>>;
    "amibaSteward/conversationSettings": (
      input: ConversationSettingsInput,
    ) => Promise<RemoteResult<ConversationView>>;
    "amibaSteward/ensureStewardSession": (
      stewardId: string,
    ) => Promise<RemoteResult<{ sessionId: string; sessionIds?: string[] }>>;
    "amibaSteward/listTasks": (input: {
      stewardId: string;
      includeDone: boolean;
    }) => Promise<RemoteResult<StewardTask[]>>;
    "amibaSteward/adopt": (input: {
      stewardId: string;
      sessionId: string;
      title?: string;
    }) => Promise<RemoteResult<AdoptResult>>;
    "amibaSteward/closeTask": (input: {
      stewardId: string;
      id: string;
    }) => Promise<RemoteResult<StewardTask>>;
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

const profileSchema = z.object({
  name: z.string(),
  responsibilities: z.string(),
  background: z.string(),
  context: z.string(),
});
const instanceSchema = profileSchema.extend({
  id: z.string(),
  sessionIds: z.array(z.string()),
  state: z.object({
    version: z.literal(1),
    stewardSessionId: z.string().optional(),
    basePreset: z.string().optional(),
    extensionVersion: z.number().optional(),
    tasks: z.array(taskSchema),
  }),
});
const codec = (schema: z.ZodType, type: string) => ({
  mode: "strict" as const,
  typeSymbol: `@amiba/steward#${type}`,
  schema,
});
const parameter = (schema: z.ZodType, type: string) => ({
  name: "input",
  wire: "input",
  source: "json" as const,
  codec: codec(schema, type),
});

/** Strict DSH Remote contract consumed by the steward Client plugin. */
export const AMIBA_STEWARD_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-steward",
  descriptors: [
    descriptor("instances", [], codec(z.array(instanceSchema), "instances")),
    descriptor(
      "saveInstance",
      [
        parameter(
          profileSchema.extend({ id: z.string().optional() }),
          "profile-input",
        ),
      ],
      codec(instanceSchema, "instance"),
    ),
    descriptor(
      "deleteInstance",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      codec(
        z.object({ id: z.string(), deleted: z.boolean() }),
        "deleted-instance",
      ),
    ),
    descriptor(
      "conversationSettings",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/steward#conversation-settings-input",
            schema: conversationSettingsInput,
          },
        },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/steward#conversation-view",
        schema: conversationViewSchema,
      },
    ),
    descriptor(
      "ensureStewardSession",
      [
        {
          name: "stewardId",
          wire: "stewardId",
          source: "json",
          codec: stringCodec,
        },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/steward#session",
        schema: z.object({
          sessionId: z.string(),
          sessionIds: z.array(z.string()).optional(),
        }),
      },
    ),
    descriptor(
      "listTasks",
      [
        parameter(
          z.object({ stewardId: z.string(), includeDone: z.boolean() }),
          "list-tasks-input",
        ),
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/steward#tasks",
        schema: z.array(taskSchema),
      },
    ),
    descriptor(
      "adopt",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/steward#adopt-input",
            schema: adoptInputSchema,
          },
        },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/steward#adopt-result",
        schema: adoptResultSchema,
      },
    ),
    descriptor(
      "closeTask",
      [
        parameter(
          z.object({ stewardId: z.string(), id: z.string() }),
          "close-task-input",
        ),
      ],
      { mode: "strict", typeSymbol: "@amiba/steward#task", schema: taskSchema },
    ),
  ],
};
