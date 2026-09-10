import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { BackgroundJobs } from "./service.js";
import { SubagentJobs } from "./subagent-jobs.js";
export type { JobPresentation } from "./service.js";
export const name = "amiba-background-jobs";
export const inject = ["jobs", "agents", "tools", "subagents", "amibaSessionStorage"];
declare module "@deepseek-ai/cordis" { interface Context { amibaBackgroundJobs: BackgroundJobs } }
class JobsRemote extends TypertRemoteService {
  constructor(ctx: Context, private jobs: BackgroundJobs) { super(ctx, "amibaJobs"); }
  @Remote relations(sessionId: string) { return this.jobs.history(sessionId); }
  @Remote async inspect(sessionId: string, id: string) { return this.jobs.inspect(sessionId, id); }
  @Remote stop(sessionId: string, id: string) { this.jobs.stop(sessionId, id); return true; }
}
export function apply(ctx: Context): void {
  const jobs = new BackgroundJobs(ctx);
  ctx.provide("amibaBackgroundJobs", jobs);
  new JobsRemote(ctx, jobs);
  new SubagentJobs(ctx, jobs);
}

export { appendPresentationNotice } from "./notice.js";
