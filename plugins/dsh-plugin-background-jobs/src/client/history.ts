import type { JobRelation } from "../remote.js";
type LiveJob = {
  id: string;
  kind: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
};
/** Durable record identity is used for UI navigation; runtime ids stay runtime-only. */
export function taskRows(
  live: readonly LiveJob[],
  records: readonly JobRelation[],
) {
  const rows = records.map((row) => ({
      id: row.recordId,
      recordId: row.recordId as string | undefined,
      jobId: row.id,
      kind: row.kind,
      status: row.status as string,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      updatedAt: row.updatedAt as number | undefined,
      title: row.title,
      command: row.command,
      callId: row.callId,
    }));
  for (const job of live) {
    const saved = rows.find(
      (row) => row.jobId === job.id && row.startedAt === job.startedAt,
    );
    if (saved) Object.assign(saved, job, { id: saved.id });
    else
      rows.push({
        ...job,
        id: `pending:${job.id}:${job.startedAt}`,
        recordId: undefined,
        finishedAt: job.finishedAt,
        jobId: job.id,
        updatedAt: undefined,
        title: "",
        command: undefined,
        callId: undefined,
      });
  }
  return rows;
}

export const isCommand = (job: { kind: string; callId?: string }) =>
  !!job.callId && ["bash", "pwsh", "pty-send"].includes(job.kind);
