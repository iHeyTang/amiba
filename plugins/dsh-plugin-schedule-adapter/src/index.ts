import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { applyScheduleHttp } from "./http.js";
import { DshScheduleManager } from "./manager.js";
import { applyScheduleNotifications } from "./notify.js";
import { applySchedulesRemote } from "./remote-service.js";

export const name = "amiba-schedule-adapter";
export const inject = ["agents", "tools"];

export interface Config {
  apiToken: string;
}

export const Config: z<Config> = z.object({
  apiToken: z.string().default(""),
});

/** Desktop UI adapter for the official DSH schedule plugin. */
export function apply(ctx: Context, config: Config): void {
  const manager = new DshScheduleManager(ctx);
  ctx.effect(() => () => manager.dispose(), "amiba-schedule-adapter");
  applySchedulesRemote(ctx, manager);
  applyScheduleNotifications(ctx);
  if (config.apiToken) {
    ctx.inject(["webServer"], (httpCtx) => {
      applyScheduleHttp(httpCtx, config, manager);
    });
  }
}
