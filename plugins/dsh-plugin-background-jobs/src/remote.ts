import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
export const relation = z.object({
  id: z.string(),
  callId: z.string().optional(),
  title: z.string(),
  command: z.string().optional(),
  recordId: z.string(),
  kind: z.string(),
  status: z.enum(["running", "stopping", "completed", "failed", "killed", "interrupted"]),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  updatedAt: z.number(),
  resultCallIds: z.array(z.string()),
});
export type JobRelation = z.infer<typeof relation>;
export interface JobDetail {
  sessionId: string;
  id: string;
  title: string;
  callId?: string;
  output: string;
  liveOutput: boolean;
  toolName?: string;
  outputAvailable: boolean;
}
const detail = z.object({
  sessionId: z.string(),
  id: z.string(),
  title: z.string(),
  command: z.string().optional(),
  callId: z.string().optional(),
  output: z.string(),
  liveOutput: z.boolean(),
  toolName: z.string().optional(),
  outputAvailable: z.boolean(),
});
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaJobs: {
      relations(sessionId: string): Promise<RemoteResult<JobRelation[]>>;
      inspect(sessionId: string, id: string): Promise<RemoteResult<JobDetail>>;
      stop(sessionId: string, id: string): Promise<RemoteResult<boolean>>;
    };
  }
  interface TypertRemoteMap {
    "amibaJobs/relations": (
      sessionId: string,
    ) => Promise<RemoteResult<JobRelation[]>>;
    "amibaJobs/inspect": (
      sessionId: string,
      id: string,
    ) => Promise<RemoteResult<JobDetail>>;
    "amibaJobs/stop": (
      sessionId: string,
      id: string,
    ) => Promise<RemoteResult<boolean>>;
  }
}
export const JOBS_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-background-jobs",
  descriptors: ["inspect", "stop", "relations"].map((method) => ({
    id: `@amiba/dsh-plugin-background-jobs#amibaJobs/${method}`,
    service: "amibaJobs",
    namespace: "amibaJobs",
    method,
    invocation: { kind: "direct" },
    parameters: (method === "relations"
      ? ["sessionId"]
      : ["sessionId", "id"]
    ).map((name) => ({
      name,
      wire: name,
      source: "json",
      codec: {
        mode: "strict",
        typeSymbol: "@amiba/jobs#string",
        schema: z.string(),
      },
    })),
    result: {
      mode: "strict",
      typeSymbol: `@amiba/jobs#${method}`,
      schema:
        method === "inspect"
          ? detail
          : method === "relations"
            ? z.array(relation)
            : z.boolean(),
    },
  })),
};
