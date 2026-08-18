import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { applyMessageCenter } from "./center.js";
import { applyMessagingRemote } from "./remote-service.js";

export * from "./center.js";
export * from "./store.js";

export const name = "amiba-messaging-core";
export const inject = [
  "agents",
  "agentPresets",
  "sessionPersistence",
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
