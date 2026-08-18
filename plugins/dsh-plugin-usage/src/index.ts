import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { DshUsageReader } from "./reader.js";
import { applyUsageRemote } from "./remote-service.js";
import { ToolActivityRecorder } from "./tool-activity-recorder.js";

export const name = "amiba-usage";
export const inject = ["sessionQuery"];

export interface Config {
  /** Directory for the plugin-owned tool-activity ledger (day buckets +
   *  lifetime aggregate). Supplied by the bundle composition, e.g.
   *  `dshHomePath('amiba-tool-activity')`. */
  root: string;
}

export const Config = z.object({
  root: z.string().required(),
});

export function apply(ctx: Context, config: Config): void {
  const toolActivity = new ToolActivityRecorder(config.root);
  // Post-commit append feed: every tool/call + tool/result this runtime
  // executes, published live (constructor seeds — resume/replay — never
  // publish, so replayed history is not double-counted).
  ctx.on("session/event", (session, event) => {
    toolActivity.accept(String(session.id), event);
  });
  applyUsageRemote(ctx, new DshUsageReader(ctx), toolActivity);
}
