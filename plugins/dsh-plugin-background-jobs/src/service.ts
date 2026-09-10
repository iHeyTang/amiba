import { appendPresentationNotice } from "./notice.js";
import type { PresentationNotice } from "@amiba/app-runtime/protocol";
import type {} from "@deepseek-ai/dsh-session";
import { randomUUID } from "node:crypto";

declare module "@deepseek-ai/dsh-session" {
  interface SessionEventMap {
    "amiba/notice": PresentationNotice;
  }
}
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { JobId } from "@deepseek-ai/dsh-jobs";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type {} from "@amiba/dsh-plugin-session-storage";
import type { Domain } from "@deepseek-ai/dsh-storage-domain";
import type { JobSnapshot } from "@deepseek-ai/dsh-jobs";
import { jobRecords, type JobRecord } from "./records.js";
import type { JobDetail } from "./remote.js";

export interface JobPresentation {
  title: string;
  toolName?: string;
  /** Must be non-consuming: never call jobs.read or a model tool here. */
  peekOutput?: () => string | Promise<string>;
}

/** Presentation only. Lifecycle and authorization remain in ctx.jobs. */
export class BackgroundJobs {
  private calls = new AsyncLocalStorage<Readonly<ToolExecution>>();
  private details = new Map<string, Pick<JobDetail, "sessionId" | "id" | "output" | "title" | "callId">>();
  private presentations = new Map<string, JobPresentation>();
  private finishing = new Set<Promise<void>>();
  private epoch = randomUUID();
  private records = new Map<string, JobRecord>();
  private stores = new Map<string, Promise<Domain<typeof jobRecords>>>();
  private writes = new Map<string, Promise<void>>();
  private failures = new Map<string, unknown>();
  constructor(private ctx: Context) {
    ctx.on("tools/execute", (exec, next) =>
      this.calls.run(exec, async () => {
        const result = await next();
        if (exec.agent) await this.flush(exec.agent.id);
        return result;
      }),
    );
    ctx.effect(
      () =>
        ctx.jobs.onJobsChanged((owner) => {
          if (!owner) return;
          const current = ctx.jobs.list(owner);
          const ids = new Set(current.map((job) => job.id));
          for (const [key, detail] of this.details) {
            if (detail.sessionId === owner.id && !ids.has(detail.id as JobId)) {
              const record = this.current(owner.id, detail.id);
              if (
                record &&
                (record.status === "running" || record.status === "stopping")
              ) {
                record.status = "interrupted";
                record.updatedAt = Date.now();
                this.save(record);
              }
              this.details.delete(key);
              this.presentations.delete(key);
            }
          }
          const exec = this.calls.getStore();
          for (const job of current) {
            const key = this.key(owner.id, job.id);
            if (!this.details.has(key))
              this.details.set(key, {
                sessionId: owner.id,
                id: job.id,
                output: "",
                title: "",
                ...(exec?.agent === owner
                  ? { callId: exec.rootCallId ?? exec.callId }
                  : {}),
              });
            this.capture(owner.id, job);
            const record = this.current(owner.id, job.id);
            if (record && exec?.agent === owner && !record.toolName) {
              record.toolName = exec.name;
              const command = (exec.arguments as {command?:unknown} | null)?.command;
              if (["bash","pwsh","pty-send"].includes(job.kind) && typeof command === "string") record.command = command;
              this.save(record);
            }
          }
        }),
      "background-jobs: observe registry",
    );
    ctx.effect(
      () =>
        ctx.jobs.onJobDone((job, owner) => {
          const finish = (async () => {
            if (!owner) return;
            if (job.status === "running" || job.status === "stopping") return;
            const status = {
              completed: "已完成",
              failed: "失败",
              killed: "已取消",
            }[job.status];
            if (!status) return;
            if (job.finishedAt === undefined) throw new Error("Settled job has no finish timestamp");
          const label =
              this.presentations.get(this.key(owner.id, job.id))?.title ||
              "后台任务";
            const summary = `${label} · ${status}`;
            const callId = this.details.get(this.key(owner.id, job.id))?.callId;
            this.capture(owner.id, job);
            await this.snapshotOutput(owner.id, job.id);
            await this.flush(owner.id);
            if (ctx.agents.get(owner.id) !== owner) return;
            appendPresentationNotice(owner.session, {
              placement: callId
                ? { kind: "execution", sessionId: owner.id, callId }
                : { kind: "standalone" },
              version: 1,
              id: randomUUID(),
              source: "amiba-background-jobs",
              summary,
              body: `${summary}\n耗时 ${Math.max(0, Math.floor((job.finishedAt - job.startedAt) / 1000))} 秒`,
              reference: {
                kind: "background-job",
                sessionId: owner.id,
                id: this.current(owner.id, job.id)!.recordId,
                instance: String(job.startedAt),
              },
            });
          })();
          this.finishing.add(finish);
          void finish
            .finally(() => this.finishing.delete(finish))
            .catch(() => {});
          return finish;
        }),
      "background-jobs: completion notices",
    );
    ctx.on("tools/result", (exec, result) => {
      if (!exec.agent) return;
      const args = exec.arguments as { job_id?: unknown } | null;
      // Canonical job controllers use job_id. This only observes already
      // produced tool output; it never advances the registry's read cursor.
      const id =
        args && typeof args.job_id === "string" ? args.job_id : undefined;
      if (!id) return;
      const detail = this.details.get(this.key(exec.agent.id, id));
      if (!detail) return;
      // job_output exposes canonical text separately from its status footer.
      // Final output reads are idempotent; replace them instead of duplicating them.
      const value = !result.isError ? result.value as {text?:unknown;job?:{status?:string}} : undefined;
      if (exec.name === "job_output" && typeof value?.text === "string") {
        const live = value.job?.status === "running" || value.job?.status === "stopping";
        detail.output = (live ? detail.output + value.text : value.text).slice(-65536);
      } else if (exec.name !== "job_kill") {
        const text = result.content.filter(p=>p.type === "text").map(p=>p.text).join("\n");
        detail.output = ([detail.output, text].filter(Boolean).join("\n")).slice(-65536);
      }
      const current = this.current(exec.agent.id, id);
      if (current) {
        current.output = detail.output;
        current.outputAvailable = current.outputAvailable || exec.name !== "job_kill";
        const callId = exec.rootCallId ?? exec.callId;
        if (!current.resultCallIds.includes(callId))
          current.resultCallIds.push(callId);
        this.save(current);
      }
    });
    ctx.effect(
      () => async () => {
        await this.flushAll();
        this.details.clear();
        this.presentations.clear();
        this.calls.disable();
      },
      "background-jobs: dispose",
    );
  }
  private key(sessionId: string, id: string) {
    return JSON.stringify([sessionId, id]);
  }
  private owner(sessionId: string): Agent {
    const owner = this.ctx.agents.get(sessionId as Agent["id"]);
    if (!owner) throw new Error("This session is no longer active");
    return owner;
  }
  /** Producers may supply safe human labels and independent output previews. */
  present(
    sessionId: string,
    id: string,
    presentation: JobPresentation,
  ): () => void {
    this.ctx.jobs.get(id as JobId, this.owner(sessionId));
    const key = this.key(sessionId, id);
    this.presentations.set(key, presentation);
    const record = this.current(sessionId, id);
    if (record) {
      record.title = presentation.title;
      if (presentation.toolName) record.toolName = presentation.toolName;
      this.save(record);
    }

    return () => {
      if (this.presentations.get(key) === presentation)
        this.presentations.delete(key);
    };
  }
  private current(sessionId: string, id: string) {
    return [...this.records.values()]
      .reverse()
      .find(
        (record) =>
          record.sessionId === sessionId &&
          record.id === id &&
          record.epoch === this.epoch,
      );
  }
  private store(sessionId: string) {
    let pending = this.stores.get(sessionId);
    if (!pending) {
      pending = this.ctx.amibaSessionStorage
        .open(sessionId, "background-jobs", jobRecords)
        .then(async (domain) => {
          for (const [key, saved] of domain.table("jobs").entries()) {
            if (saved.sessionId !== sessionId)
              throw new Error("Foreign task in session storage");
            if (
              saved.epoch !== this.epoch &&
              (saved.status === "running" || saved.status === "stopping")
            ) {
              // The last observed time is not a fabricated completion timestamp.
              await domain
                .table("jobs")
                .put(key, { ...saved, status: "interrupted" });
            }
          }
          return domain;
        });
      this.stores.set(sessionId, pending);
      void pending.catch(() => {
        this.stores.delete(sessionId);
      });
    }
    return pending;
  }
  private capture(sessionId: string, job: JobSnapshot) {
    let record = this.current(sessionId, job.id);
    if (record && record.startedAt !== job.startedAt) record = undefined;
    const detail = this.details.get(this.key(sessionId, job.id));
    const presentation = this.presentations.get(this.key(sessionId, job.id));
    record = {
      ...(record ?? {
        recordId: randomUUID(),
        epoch: this.epoch,
        sessionId,
        id: job.id,
        title: "",
        output: "",
        outputAvailable: false,
        resultCallIds: [],
      }),
      kind: job.kind,
      status: job.status,
      startedAt: job.startedAt,
      updatedAt: Date.now(),
      ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
      ...(detail?.callId ? { callId: detail.callId } : {}),
      ...(presentation ? { title: presentation.title } : {}),
    };
    this.records.set(record.recordId, record);
    this.save(record);
  }
  private save(record: JobRecord) {
    record.updatedAt = Date.now();
    const snapshot = structuredClone(record);
    const previous = this.writes.get(record.sessionId) ?? Promise.resolve();
    const write = previous
      .catch(() => {})
      .then(async () => {
        const domain = await this.store(record.sessionId);
        await domain.table("jobs").put(snapshot.recordId, snapshot);
        this.failures.delete(record.sessionId);
      });
    this.writes.set(record.sessionId, write);
    void write.catch((error) => {
      this.failures.set(record.sessionId, error);
      this.ctx.logger?.error(
        `Background job record could not be saved: ${String(error)}`,
      );
    });
  }
  private async snapshotOutput(sessionId: string, id: string) {
    const record = this.current(sessionId, id);
    const presentation = this.presentations.get(this.key(sessionId, id));
    if (record && presentation?.peekOutput) {
      try {
        const output = (await presentation.peekOutput()).slice(-65536);
        if (!record.outputAvailable || record.output !== output) {
          record.output = output;
          record.outputAvailable = true;
          this.save(record);
        }
      } catch (error) {
        this.ctx.logger?.warn(
          `Background output preview unavailable: ${String(error)}`,
        );
      }
    }
  }
  async flush(sessionId: string) {
    // Snapshot capture can append another write while an earlier write is flushing.
    let pending: Promise<void> | undefined;
    do {
      pending = this.writes.get(sessionId);
      await pending;
    } while (pending !== this.writes.get(sessionId));
    if (this.failures.has(sessionId)) throw this.failures.get(sessionId);
  }
  async flushAll() {
    await Promise.all([...this.finishing]);
    await Promise.all([...this.writes.keys()].map((id) => this.flush(id)));
  }
  async inspect(sessionId: string, id: string): Promise<JobDetail> {
    await this.flush(sessionId);
    const domain = await this.store(sessionId);
    const saved = domain.table("jobs").get(id);
    if (!saved) throw new Error("Task not found in this session");
    if (saved.epoch === this.epoch) {
      await this.snapshotOutput(sessionId, saved.id);
      await this.flush(sessionId);
    }
    const latest = domain.table("jobs").get(saved.recordId);
    if (!latest) throw new Error("Task record disappeared during inspection");
    return {
      ...latest,
      liveOutput:
        latest.epoch === this.epoch &&
        Boolean(
          this.presentations.get(this.key(sessionId, latest.id))?.peekOutput,
        ),
    };
  }
  async history(sessionId: string) {
    await this.flush(sessionId);
    const domain = await this.store(sessionId);
    return [...domain.table("jobs").entries()].map(([, record]) => {
      const { output, epoch, sessionId: _, ...metadata } = record;
      return metadata;
    });
  }
  stop(sessionId: string, id: string): void {
    const record = this.records.get(id);
    if (!record) throw new Error("Task record not found");
    {
      if (record.sessionId !== sessionId || record.epoch !== this.epoch)
        throw new Error("Task is no longer running in this session");
      const job = this.ctx.jobs.get(record.id as JobId, this.owner(sessionId));
      if (job.startedAt !== record.startedAt)
        throw new Error("Task instance changed");
      id = record.id;
    }
    this.ctx.jobs.kill(
      id as JobId,
      this.owner(sessionId),
      "Stopped by the user",
    );
  }
}
