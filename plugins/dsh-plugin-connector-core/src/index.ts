import type { Context } from "@deepseek-ai/cordis";
// Import needed only so `@deepseek-ai/cordis`'s `Context.credentials`
// augmentation (declared inside dsh-credentials) is loaded — connector-core
// itself only depends on the loose `CredentialsSeam` shape in center.ts.
import type {} from "@deepseek-ai/dsh-credentials";
import z from "@deepseek-ai/schemastery";

import { CapabilityUnavailableError, ConnectorCenter } from "./center.js";
import { provisionCli } from "./cli-provision.js";
import { realCliDeps } from "./cli-provision-deps.js";
import { RESTRICTED_PRESET, seedAgentPresets } from "./preset-seed.js";
import { applyConnectorsRemote } from "./remote-service.js";
import { ConnectorStore, type StoredConnect } from "./store.js";
import type { CapabilityDecl } from "./types.js";

export * from "./center.js";
export * from "./cli-provision.js";
export { AMIBA_CONNECTORS_REMOTE } from "./remote.js";
export * from "./remote.js";
export * from "./store.js";
export * from "./types.js";

export const name = "amiba-connector-core";
// This cordis version's object-form `inject` maps each service name to its
// own intercept config (`{ [service]: config }`), not a `{required,optional}`
// grouping — see plugins/dsh-plugin-connector-core/README or task-5-report
// for the grep that confirmed this. So required deps are declared as a plain
// array here; `amibaMcpManager` is intentionally NOT listed (optional dep).
export const inject = ["amibaMessageCenter", "credentials"];

export interface Config {
  root: string;
  agentPresetsRoot: string;
  /** Managed CLI cache + wrapper-script root for the `cli` capability
   * applier (`<cliRoot>/<package>@<version>/`, `<cliRoot>/wrappers/`). */
  cliRoot: string;
  /** Writable skills root the `cli` capability applier create-only seeds a
   * provisioned package's skills into. */
  skillsRoot: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  agentPresetsRoot: z.string().required(),
  cliRoot: z.string().required(),
  skillsRoot: z.string().required(),
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

  // Registered unconditionally rather than armed only once amibaMcpManager
  // is available: `ctx.inject`'s fiber body runs on a deferred microtask, so
  // when mcp-manager loads *after* connector-core, connects started during
  // this plugin's own `center.start()` boot recovery would find no "mcp"
  // entry in the map yet and land on a hard error with no way to re-apply
  // later. Resolving the manager at *apply time* instead — once per
  // capability application, via `ctx.reflect.get` (a point-in-time read that
  // doesn't require declaring `amibaMcpManager` as a hard dependency) — means
  // load order never matters: whichever loads first, every future enable
  // (including a manual retry) re-checks freshly.
  appliers.set("mcp", {
    apply: async (_connect, decl) => {
      if (decl.kind !== "mcp")
        throw new Error(`unexpected_capability_kind:${decl.kind}`);
      const manager = ctx.reflect.get("amibaMcpManager");
      if (!manager) throw new CapabilityUnavailableError("mcp_manager_unavailable");
      return await manager.registerManagedServer(decl.spec);
    },
  });

  // "cli" has no optional-dependency story like "mcp" does — provisioning is
  // pure filesystem/process work owned entirely by this plugin, so it's
  // always available and its failures are genuine (hard-fail the enable,
  // same as any other capability applier rejection).
  appliers.set("cli", {
    apply: async (_connect, decl) => {
      if (decl.kind !== "cli")
        throw new Error(`unexpected_capability_kind:${decl.kind}`);
      const handle = await provisionCli(decl.spec, realCliDeps(ctx, config));
      return () => {
        void handle.dispose();
      };
    },
  });

  const center = new ConnectorCenter(
    ctx,
    new ConnectorStore(config.root),
    ctx.amibaMessageCenter,
    ctx.credentials as never,
    appliers,
  );
  ctx.provide("amibaConnectors", center);
  applyConnectorsRemote(ctx, center);
  // Stop every live connect on plugin unload (a reload, or a full shutdown)
  // so no runtime, socket, or mcp registration is left orphaned behind a
  // torn-down amibaConnectors service.
  ctx.effect(() => () => center.stop(), "amiba-connector-core.center");
  // IM-originated sessions mount agent preset "restricted" by name; seed it
  // into the writable roster root here so that mount resolves instead of
  // messaging-core falling back to an unrestricted session with a warning.
  // Idempotent and create-only: a user's own edited or broken copy is never
  // touched, and a seeding failure is caught and logged — it must never
  // block the rest of apply() or the connector center from starting.
  await seedAgentPresets(
    config.agentPresetsRoot,
    [RESTRICTED_PRESET],
    ctx.logger("amiba-connector-core"),
  );
  await center.start();
}
