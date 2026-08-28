import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type {
  CronTaskCreateInput,
  CronTaskPatch,
  CronTaskView,
} from "./types.js";

const ruleSchema = z.union([
  z.object({ kind: z.literal("at"), at: z.string() }),
  z.object({
    kind: z.literal("daily"),
    time: z.string(),
    timeZone: z.string(),
  }),
  z.object({ kind: z.literal("every"), everySeconds: z.number() }),
]);
const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  rule: ruleSchema,
  enabled: z.boolean(),
  catchUp: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRunAt: z.number().optional(),
  lastSessionId: z.string().optional(),
  nextRunAt: z.number().nullable(),
});
const createInputSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  rule: ruleSchema,
  catchUp: z.boolean().optional(),
});
const patchSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
  rule: ruleSchema.optional(),
  enabled: z.boolean().optional(),
  catchUp: z.boolean().optional(),
});
const stringCodec = {
  mode: "strict" as const,
  typeSymbol: "typescript#string",
  schema: z.string(),
};

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaCron: {
      list(): Promise<RemoteResult<CronTaskView[]>>;
      createTask(
        input: CronTaskCreateInput,
      ): Promise<RemoteResult<CronTaskView>>;
      updateTask(
        id: string,
        patch: CronTaskPatch,
      ): Promise<RemoteResult<CronTaskView>>;
      removeTask(id: string): Promise<RemoteResult<{ id: string }>>;
      runNow(id: string): Promise<RemoteResult<CronTaskView>>;
      startCreationChat(
        seedPrompt: string,
      ): Promise<RemoteResult<{ sessionId: string }>>;
    };
  }

  interface TypertRemoteMap {
    "amibaCron/list": () => Promise<RemoteResult<CronTaskView[]>>;
    "amibaCron/createTask": (
      input: CronTaskCreateInput,
    ) => Promise<RemoteResult<CronTaskView>>;
    "amibaCron/updateTask": (
      id: string,
      patch: CronTaskPatch,
    ) => Promise<RemoteResult<CronTaskView>>;
    "amibaCron/removeTask": (
      id: string,
    ) => Promise<RemoteResult<{ id: string }>>;
    "amibaCron/runNow": (id: string) => Promise<RemoteResult<CronTaskView>>;
    "amibaCron/startCreationChat": (
      seedPrompt: string,
    ) => Promise<RemoteResult<{ sessionId: string }>>;
  }
}

function descriptor(
  method: string,
  parameters: TypertRemoteContribution["descriptors"][number]["parameters"],
  result: TypertRemoteContribution["descriptors"][number]["result"],
) {
  return {
    id: `@amiba/dsh-plugin-cron#amibaCron/${method}`,
    service: "amibaCron",
    namespace: "amibaCron",
    method,
    invocation: { kind: "direct" as const },
    parameters,
    result,
  };
}

const viewResult = {
  mode: "strict" as const,
  typeSymbol: "@amiba/cron#view",
  schema: viewSchema,
};

/** Strict DSH Remote contract consumed by the cron Client plugin. */
export const AMIBA_CRON_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-cron",
  descriptors: [
    descriptor("list", [], {
      mode: "strict",
      typeSymbol: "@amiba/cron#list",
      schema: z.array(viewSchema),
    }),
    descriptor(
      "createTask",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/cron#create-input",
            schema: createInputSchema,
          },
        },
      ],
      viewResult,
    ),
    descriptor(
      "updateTask",
      [
        { name: "id", wire: "id", source: "json", codec: stringCodec },
        {
          name: "patch",
          wire: "patch",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/cron#patch",
            schema: patchSchema,
          },
        },
      ],
      viewResult,
    ),
    descriptor(
      "removeTask",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      {
        mode: "strict",
        typeSymbol: "@amiba/cron#removed",
        schema: z.object({ id: z.string() }),
      },
    ),
    descriptor(
      "runNow",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      viewResult,
    ),
    descriptor(
      "startCreationChat",
      [
        {
          name: "seedPrompt",
          wire: "seedPrompt",
          source: "json",
          codec: stringCodec,
        },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/cron#creation-chat",
        schema: z.object({ sessionId: z.string() }),
      },
    ),
  ],
};
