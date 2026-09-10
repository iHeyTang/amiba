import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { applyMessageCenter } from "./center.js";

export * from "./approval.js";
export * from "./center.js";
export * from "./store.js";

export const name = "amiba-messaging-core";
// `workspaceRegistry` (`@deepseek-ai/dsh-workspace`, exposing the DSH-wide
// archived-session set) is deliberately NOT listed here: this cordis
// version's array-form `inject` has no optional flag (object-form `inject`
// maps each service name to its own intercept config, not a
// `{required,optional}` grouping — see the identical note on
// dsh-plugin-steward's and dsh-plugin-connector-core's own `inject`), and the
// DSH host runtime mounts it unconditionally but this plugin's own tests
// (and any bundle assembled without the base row) may still omit it.
// `MessageChannelCenter` reads it on-demand via `ctx.reflect.get` — the same
// non-throwing, point-in-time lookup already used for the optional
// `agentDefaultModel` service — and treats its absence as "nothing is
// archived".
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
  await center.start();
}
