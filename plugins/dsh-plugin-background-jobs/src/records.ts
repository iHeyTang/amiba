import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
export const jobRecord = z.object({
  recordId: z.string(),
  sessionId: z.string(),
  id: z.string(),
  epoch: z.string(),
  kind: z.string(),
  status: z.enum([
    "running",
    "stopping",
    "completed",
    "failed",
    "killed",
    "interrupted",
  ]),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  updatedAt: z.number(),
  title: z.string(),
  command: z.string().optional(),
  toolName: z.string().optional(),
  callId: z.string().optional(),
  resultCallIds: z.array(z.string()),
  output: z.string(),
  outputAvailable: z.boolean(),
});
export type JobRecord = z.infer<typeof jobRecord>;
export const jobRecords = defineDomain({
  name: "records",
  version: 1,
  tables: { jobs: domainTable<string, JobRecord>(jobRecord) },
});
