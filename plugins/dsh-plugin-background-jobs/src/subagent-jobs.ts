import type { Context } from "@deepseek-ai/cordis";
import { foldSubagentDescriptor, type SubagentRunEndInfo } from "@deepseek-ai/dsh-subagent";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { JobId, JobOutcome } from "@deepseek-ai/dsh-jobs";
import type { BackgroundJobs } from "./service.js";

declare module "@deepseek-ai/dsh-jobs" { interface JobKindMap { "subagent-turn": "subagent-turn" } }
/** One official continuation epoch = one job; no second child lifecycle.
 * The official subagent runtime remains the sole model-completion reporter. */
export class SubagentJobs {
  private active = new Map<string, { finish: (result: JobOutcome) => void; jobId: JobId; owner: Agent; childId: string; preview: { text: string } }>();
  constructor(ctx: Context, presentation: BackgroundJobs) {
    ctx.on("subagent/start", info => {
      const child = ctx.agents.get(info.id);
      if (!child || foldSubagentDescriptor(child.session.events)?.mode !== "continuable") return;
      const parentId = child.session.header.parentSession;
      const owner = parentId ? ctx.agents.get(parentId) : undefined;
      if (!owner || this.active.has(info.runId)) return;
      let finish!: (result: JobOutcome) => void;
      const done = new Promise<JobOutcome>(resolve => { finish = resolve; });
      const jobId = ctx.jobs.start({ kind: "subagent-turn", label: "子 Agent 本轮执行", owner,
        run: () => ({ done, cancel: () => {
          void ctx.subagents.drainContinuableChildren(owner, [info.id]).catch(error => {
            finish({ status: "failed", detail: `Could not drain subagent run: ${String(error)}` });
          });
        } }),
      });
      const preview = { text: "" };
      this.active.set(info.runId, { finish, jobId, owner, childId: info.id, preview });
      presentation.present(owner.id, jobId, { title: "子 Agent 本轮执行", peekOutput: () => preview.text });
      // A real collector waits before settlement: jobs suppresses its duplicate
      // model notice, while subagents delivers the canonical output and wakeup.
      // A timeout renews the wait; no polling or consumption of stream output.
      void (async () => {
        while (ctx.jobs.get(jobId, owner).status === "running" || ctx.jobs.get(jobId, owner).status === "stopping") {
          await ctx.jobs.wait(jobId, 2_147_483_647, owner);
        }
      })().catch(error => ctx.logger.warn(`subagent job collector: ${String(error)}`));
    });
    ctx.on("subagent/end", info => this.end(info));
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.active.entries()].map(async ([runId, run]) => {
        const child = ctx.agents.get(run.childId as Agent["id"]);
        try {
          if (child) await ctx.subagents.drainContinuableChildren(run.owner, [child.id]);
        } catch (error) {
          run.finish({ status: "failed", detail: `Could not drain child during unload: ${String(error)}` });
          this.active.delete(runId);
          return;
        }
        // The child has quiesced (or left the registry). Lifecycle listeners
        // may already be detached during plugin disposal; release this waiter.
        run.finish({ status: "killed", detail: "Background job bridge unloaded" });
        this.active.delete(runId);
      }));
    }, "background-jobs: subagent references");
  }
  private end(info: SubagentRunEndInfo) {
    const run = this.active.get(info.runId);
    if (!run) return;
    this.active.delete(info.runId);
    run.preview.text = (info.lastAssistantMessage ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
    run.finish({ status: info.stopReason === "completed" ? "completed" : info.stopReason === "aborted" ? "killed" : "failed",
      detail: info.stopReason, output: JSON.stringify({ content: info.lastAssistantMessage ?? [] }),
    });
  }
}
