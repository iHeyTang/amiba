import type { Context } from "@deepseek-ai/cordis";

import { DshUsageReader } from "./reader.js";
import { applyUsageRemote } from "./remote-service.js";

export const name = "amiba-usage";
export const inject = ["sessionQuery"];

export function apply(ctx: Context): void {
  applyUsageRemote(ctx, new DshUsageReader(ctx));
}
