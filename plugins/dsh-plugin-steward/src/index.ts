import { homedir } from "node:os";

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { STEWARD_PRESET, STEWARD_PRESET_ID, seedAgentPresets } from "./preset-seed.js";
import { applyStewardRemote } from "./remote-service.js";
import { StewardService } from "./service.js";
import { StewardStore } from "./store.js";
import { registerStewardTools } from "./tools.js";

export * from "./remote.js";
export * from "./types.js";
export { StewardService, DISPATCH_FOOTER, formatReport } from "./service.js";
export { StewardStore } from "./store.js";

export const name = "amiba-steward";
// `workspaceRegistry` (`@deepseek-ai/dsh-workspace`, exposing the DSH-wide
// archived-session set) is deliberately NOT listed here: this cordis
// version's array-form `inject` has no optional flag (object-form `inject`
// maps each service name to its own intercept config, not a
// `{required,optional}` grouping — see the identical note on
// dsh-plugin-connector-core's own `inject`), and the DSH host runtime mounts
// it unconditionally but this plugin's own tests (and any bundle assembled
// without the base row) may still omit it. `StewardService` reads it
// on-demand via `ctx.reflect.get` — the same non-throwing, point-in-time
// lookup already used for the optional `agentDefaultModel` service — and
// treats its absence as "nothing is archived".
export const inject = ["agents", "sessions", "tools", "agentPresets", "sessionPersistence", "sessionQuery", "sessionTitle"];

export interface Config {
  root: string;
  agentPresetsRoot: string;
  defaultCwd?: string;
  taskPreset?: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  agentPresetsRoot: z.string().required(),
  defaultCwd: z.string(),
  taskPreset: z.string(),
});

/**
 * Amiba steward (大管家): one hidden, always-live conversation that routes each
 * request to an ordinary task session and relays the reply back. Boot order:
 * seed the steward preset (create-only) → durable store → service (resumes or
 * creates the steward agent, then catches up on turns finished while down) →
 * remote for the client half.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const log = ctx.logger("amiba-steward");
  await seedAgentPresets(config.agentPresetsRoot, [STEWARD_PRESET], log);
  const store = new StewardStore(config.root, (message) => log.warn(message));
  const service: StewardService = new StewardService(ctx, store, {
    defaultCwd: config.defaultCwd ?? homedir(),
    taskPreset: config.taskPreset,
    presetId: STEWARD_PRESET_ID,
    onStewardSetup: (agentCtx) => registerStewardTools(agentCtx, service),
  });
  // The disposer returns the teardown promise so unload waits for the
  // steward agent to actually go away (cordis effect disposers may be async).
  ctx.effect(() => () => service.dispose(), "amiba-steward");
  applyStewardRemote(ctx, service);
  void service.start().catch((error) => {
    log.error(`amiba-steward: failed to start: ${String(error)}`);
  });
}
