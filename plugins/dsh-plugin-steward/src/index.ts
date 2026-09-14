import type {} from "@amiba/dsh-plugin-session-features";
import { homedir } from "node:os";

import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import {
  installRegistryExtension,
  registerStewardLifecycleTools,
} from "./registry-extension.js";
import { StewardRegistryService } from "./registry.js";
import { StewardRegistryStore } from "./registry-store.js";
import { applyStewardRemote } from "./remote-service.js";

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
export const inject = [
  "agents",
  "sessions",
  "tools",
  "agentPresets",
  "sessionPersistence",
  "sessionQuery",
  "sessionTitle",
  "systemPrompt",
  "amibaSessionFeatures",
  "amibaConversations",
];

export interface Config {
  root: string;
  /** Optional base preset. Resolved once and pinned in the session header. */
  basePreset?: string;
  defaultCwd?: string;
  taskPreset?: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  basePreset: z.string(),
  defaultCwd: z.string(),
  taskPreset: z.string(),
});

/** One plugin registers independent entry engines, restores their session
 * features and exposes owner-facing lifecycle tools in ordinary conversations. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const log = ctx.logger("amiba-steward");
  const store = new StewardRegistryStore(config.root);
  const service = new StewardRegistryService(ctx, store, {
    defaultCwd: config.defaultCwd ?? homedir(),
    taskPreset: config.taskPreset,
    basePreset: config.basePreset,
    onStewardSetup: (agentCtx) =>
      ctx.amibaSessionFeatures.ensure(agentCtx, [
        { sessionId: "", plugin: name, version: 1 },
      ]),
  });
  ctx.effect(
    () =>
      ctx.amibaConversations.registerSubmitHandler(name, (_origin, sessionId) =>
        service
          .forSession(sessionId)
          .then((engine) => engine.prepareStewardSession(sessionId)),
      ),
    "amiba-steward.conversations",
  );
  ctx.effect(
    () =>
      ctx.amibaSessionFeatures.register(name, {
        version: 1,
        install: (agentCtx) => installRegistryExtension(agentCtx, service),
      }),
    "amiba-steward.feature",
  );
  // The disposer returns the teardown promise so unload waits for the
  // steward agent to actually go away (cordis effect disposers may be async).
  ctx.effect(() => () => service.dispose(), "amiba-steward");
  await service.initialize();
  ctx.provide("amibaScopedMemory", {
    ownsSession: (id: string) =>
      store
        .snapshot()
        .instances.some(
          (item) =>
            item.sessionIds.includes(id) ||
            item.state.tasks.some((task) => task.sessionId === id),
        ),
  });
  ctx.effect(
    () =>
      ctx.tools.guard((execution) => {
        if (
          !execution.agent ||
          !(
            execution.name.startsWith("memos_") ||
            execution.name === "amiba_memory_correct"
          )
        )
          return;
        return store
          .snapshot()
          .instances.some(
            (item) =>
              item.sessionIds.includes(String(execution.agent!.id)) ||
              item.state.tasks.some(
                (task) => task.sessionId === execution.agent!.id,
              ),
          )
          ? "This conversation uses steward-scoped context, not global memory."
          : undefined;
      }),
    "amiba-steward.memory-boundary",
  );
  registerStewardLifecycleTools(ctx, service);
  applyStewardRemote(ctx, service);
  void service.start().catch((error) => {
    log.error(`amiba-steward: failed to start: ${String(error)}`);
  });
}
