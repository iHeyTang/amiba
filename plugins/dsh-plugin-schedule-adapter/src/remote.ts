import type {
  AgentScheduleCreateInput,
  AgentScheduleView,
} from "@amiba/app-runtime/platform";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

const atSchema = z.union([
  z.string(),
  z.object({ date: z.string(), time: z.string(), time_zone: z.string() }),
]);
const createInputSchema = z.object({
  prompt: z.string(),
  afterSeconds: z.number().optional(),
  everySeconds: z.number().optional(),
  at: atSchema.optional(),
});
const scheduleSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: z.enum(["after", "at", "every"]),
  prompt: z.string(),
  scheduledAt: z.string(),
  state: z.enum(["scheduled", "overdue"]),
  deliveryMode: z.literal("session-local"),
  afterSeconds: z.number().optional(),
  everySeconds: z.number().optional(),
});
const removedSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
  code: z.literal("schedule_not_found").optional(),
});
const stringCodec = {
  mode: "strict" as const,
  typeSymbol: "typescript#string",
  schema: z.string(),
};

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaSchedules: {
      list(sessionId: string): Promise<RemoteResult<AgentScheduleView[]>>;
      create(
        sessionId: string,
        input: AgentScheduleCreateInput,
      ): Promise<RemoteResult<AgentScheduleView>>;
      removeSchedule(
        sessionId: string,
        id: string,
      ): Promise<
        RemoteResult<{
          id: string;
          deleted: boolean;
          code?: "schedule_not_found";
        }>
      >;
    };
  }

  interface TypertRemoteMap {
    "amibaSchedules/list": (
      sessionId: string,
    ) => Promise<RemoteResult<AgentScheduleView[]>>;
    "amibaSchedules/create": (
      sessionId: string,
      input: AgentScheduleCreateInput,
    ) => Promise<RemoteResult<AgentScheduleView>>;
    "amibaSchedules/removeSchedule": (
      sessionId: string,
      id: string,
    ) => Promise<
      RemoteResult<{
        id: string;
        deleted: boolean;
        code?: "schedule_not_found";
      }>
    >;
  }
}

function descriptor(
  method: string,
  parameters: TypertRemoteContribution["descriptors"][number]["parameters"],
  result: TypertRemoteContribution["descriptors"][number]["result"],
) {
  return {
    id: `@amiba/dsh-plugin-schedule-adapter#amibaSchedules/${method}`,
    service: "amibaSchedules",
    namespace: "amibaSchedules",
    method,
    invocation: { kind: "direct" as const },
    parameters,
    result,
  };
}

/** Strict DSH Remote contract consumed by the Schedule Client plugin. */
export const AMIBA_SCHEDULES_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-schedule-adapter",
  descriptors: [
    descriptor(
      "list",
      [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: stringCodec,
        },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/schedules#list",
        schema: z.array(scheduleSchema),
      },
    ),
    descriptor(
      "create",
      [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: stringCodec,
        },
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "@amiba/schedules#create-input",
            schema: createInputSchema,
          },
        },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/schedules#view",
        schema: scheduleSchema,
      },
    ),
    descriptor(
      "removeSchedule",
      [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: stringCodec,
        },
        { name: "id", wire: "id", source: "json", codec: stringCodec },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/schedules#removed",
        schema: removedSchema,
      },
    ),
  ],
};
