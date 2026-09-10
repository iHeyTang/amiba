import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { applyCronRemote } from "./remote-service.js";
import { registerCronTools } from "./tools.js";
import { CronService } from "./service.js";
import { DshCronStore } from "./store.js";

export * from "./remote.js";
export * from "./types.js";
export { CronService } from "./service.js";
export { DshCronStore } from "./store.js";
export { assertValidRule, missedRunAt, nextRunAt } from "./rules.js";

export const name = "amiba-cron";
export const inject = ["agents", "sessions", "tools", "sessionPersistence"];

export interface Config {
  root: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
});

/**
 * Amiba cron: durable task definitions that spawn a fresh agent session on
 * schedule. Deliberately named apart from `@deepseek-ai/dsh-schedule` — that
 * plugin owns session-local reminders (an agent capability); this one owns
 * "at this time, start a new task", which upstream does not provide.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new CronService(ctx, new DshCronStore(config.root));
  ctx.effect(() => () => service.dispose(), "amiba-cron");
  applyCronRemote(ctx, service);
  registerCronTools(ctx, service);
  void service.start();
}
