import type { Context } from "@deepseek-ai/cordis";
// Import needed only so `@deepseek-ai/cordis`'s `Context.credentials`
// augmentation (declared inside dsh-credentials) is loaded — connector-core
// itself only depends on the loose `CredentialsSeam` shape in center.ts.
import type {} from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";

import { ConnectorCenter } from "./center.js";
import { ConnectorStore, type StoredConnect } from "./store.js";
import type { CapabilityDecl } from "./types.js";

export * from "./center.js";
export * from "./store.js";
export * from "./types.js";

export const name = "amiba-connector-core";
// This cordis version's object-form `inject` maps each service name to its
// own intercept config (`{ [service]: config }`), not a `{required,optional}`
// grouping — see plugins/dsh-plugin-connector-core/README or task-5-report
// for the grep that confirmed this. So required deps are declared as a plain
// array here, and the optional `amibaMcpManager` capability applier is armed
// lazily below via `ctx.inject`, matching the guarded-injection pattern used
// by dsh-plugin-schedule-adapter and dsh-plugin-runtime-gateway.
export const inject = ["amibaMessageCenter", "credentials"];

export interface Config {
  root: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
});

declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaConnectors: ConnectorCenter;
  }
}

/**
 * Connect lifecycle mechanism: platform bindings that fan out into messaging
 * channels and tool capabilities. Contains no platform knowledge itself —
 * platform adapters register a `ConnectorProvider` and see only their handle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const appliers = new Map<
    string,
    { apply: (connect: StoredConnect, decl: CapabilityDecl) => Promise<() => void> }
  >();

  ctx.inject(["amibaMcpManager"], (mcpCtx) => {
    mcpCtx.effect(() => {
      appliers.set("mcp", {
        apply: async (_connect, decl) => {
          if (decl.kind !== "mcp")
            throw new Error(`unexpected_capability_kind:${decl.kind}`);
          return mcpCtx.amibaMcpManager.registerManagedServer(decl.spec);
        },
      });
      return () => {
        appliers.delete("mcp");
      };
    }, "amiba-connector-core.mcp-applier");
  });

  const center = new ConnectorCenter(
    ctx,
    new ConnectorStore(config.root),
    ctx.amibaMessageCenter,
    ctx.credentials as never,
    appliers,
  );
  ctx.provide("amibaConnectors", center);
  await center.start();
}
