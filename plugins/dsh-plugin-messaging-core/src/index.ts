import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { applyMessageCenter } from "./center.js";
import { applyMessagingRemote } from "./remote-service.js";

export * from "./approval.js";
export * from "./center.js";
export * from "./store.js";

export const name = "amiba-messaging-core";
export const inject = [
  "agents",
  "agentPresets",
  "sessionPersistence",
  // The tool-approval waterfall this plugin answers for IM-bound sessions.
  // Composed by dsh-base ahead of every product bundle, so requiring it costs
  // nothing; the relay still checks for it before registering, which keeps
  // headless harnesses (and any runtime that drops it) working.
  "approval",
];

export interface Config {
  root: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
});

/** Provider-neutral message hub; channel transports attach as sibling plugins. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const center = applyMessageCenter(ctx, config.root);
  applyMessagingRemote(ctx, center);
  await center.start();
}
