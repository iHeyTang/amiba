import { provideMcpConnection, type McpAccessView } from "@amiba/dsh-plugin-mcp-manager";
import type { Context } from "@deepseek-ai/cordis";
// Import needed only so `@deepseek-ai/cordis`'s `Context.credentials`
// augmentation (declared inside dsh-credentials) is loaded — connector-core
// itself only depends on the loose `CredentialsSeam` shape in center.ts.
import type {} from "@deepseek-ai/dsh-credentials";
// Import needed only so `@deepseek-ai/cordis`'s `Context.userQuestions`
// augmentation (declared inside dsh-user-questions) is loaded —
// registerConnectAddTool's own `ConnectToolContext` shape is loose, but
// passing the real `ctx` into it below requires `Context` to actually carry
// `.userQuestions`.
import type {} from "@deepseek-ai/dsh-user-questions";
import z from "@deepseek-ai/schemastery";

import { ConnectorCenter, type CapabilityApplier } from "./center.js";
import { provisionCli } from "./cli-provision.js";
import { realCliDeps } from "./cli-provision-deps.js";
import { registerConnectAddTool } from "./connect-tool.js";
import { applyConnectorsRemote } from "./remote-service.js";
import { ConnectorStore, type StoredConnect } from "./store.js";

export * from "./center.js";
export * from "./cli-provision.js";
export { AMIBA_CONNECTORS_REMOTE } from "./remote.js";
export * from "./remote.js";
export * from "./store.js";
export * from "./types.js";

/** Stable per-connection names for CLI wrappers and carrier skills. */
export function connectInstanceKey(baseId: string, connectId: string): string {
  const slugify = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
  const suffix = connectId
    .replace(/^connect-/u, "")
    .replace(/[^A-Za-z0-9_-]/gu, "")
    .slice(0, 8);
  const sanitizedBase = slugify(baseId) || "s";
  return `${sanitizedBase}-${suffix}`;
}

export const name = "amiba-connector-core";
// This cordis version's object-form `inject` maps each service name to its
// own intercept config (`{ [service]: config }`), not a `{required,optional}`
// grouping — see plugins/dsh-plugin-connector-core/README or task-5-report
// for the grep that confirmed this. So required deps are declared as a plain
// array here; `amibaMcpManager` is intentionally NOT listed (optional dep).
export const inject = ["amibaMessageCenter", "credentials", "tools", "userQuestions"];

export interface Config {
  root: string;
  /** Managed CLI cache + wrapper-script root for the `cli` capability
   * applier (`<cliRoot>/<package>@<version>/`, `<cliRoot>/wrappers/`). */
  cliRoot: string;
  /** Writable skills root the `cli` capability applier create-only seeds a
   * provisioned package's skills into. */
  skillsRoot: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
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
  const appliers = new Map<string, CapabilityApplier>();

  appliers.set("mcp", {
    describeConnect: async connect => {
      const views: McpAccessView[] = await ctx.reflect.get("amibaMcpManager")?.access.list() ?? [];
      return views.filter(view => view.connectionId && view.configuration?.ownerId === "connector-core" && view.configuration.recordId === connect.id)
        .map(view => ({ name: view.plugin, capabilities: view.tools.map(tool => tool.title) }));
    },
    removeConnect: async connect => {
      await ctx.reflect.get("amibaMcpManager")?.access.forgetConfiguration("connector-core", connect.id);
    },
    apply: async (connect, decl) => {
      if (decl.kind !== "mcp") throw new Error(`unexpected_capability_kind:${decl.kind}`);
      const owner = { id: `connector:${connect.provider}`, name: center.listProviders().find(item => item.id === connect.provider)?.name ?? connect.provider };
      const fiber = provideMcpConnection(ctx, owner, decl.service, {
        id: `${connect.id}:${decl.service.id}`, name: connect.name,
        serviceId: decl.service.id, identity: decl.identity, server: decl.spec,
        configuration: { ownerId: "connector-core", recordId: connect.id },
      }, decl.tools);
      return Object.assign(() => fiber.dispose(), {
        updateMetadata: (updated: StoredConnect) => fiber.rename(updated.name),
      });
    },
  });

  // "cli" has no optional-dependency story like "mcp" does — provisioning is
  // pure filesystem/process work owned entirely by this plugin, so it's
  // always available and its failures are genuine (hard-fail the enable,
  // same as any other capability applier rejection).
  appliers.set("cli", {
    apply: async (connect, decl) => {
      if (decl.kind !== "cli")
        throw new Error(`unexpected_capability_kind:${decl.kind}`);
      // Instance identity is owned entirely by this applier, never by the
      // provider-declared spec (see connectInstanceKey's doc comment and
      // CliProvisionInstance in cli-provision.ts) — two connects of the same
      // provider share the identical decl.spec.id, so without deriving a
      // per-connect key here, their wrapper/carrier-skill artifacts would
      // collide on the exact same filesystem paths.
      const instance = {
        id: connectInstanceKey(decl.spec.id, connect.id),
        connectName: connect.name,
        provider: connect.provider,
      };
      const handle = await provisionCli(decl.spec, instance, realCliDeps(ctx, config));
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
  ctx.inject(["amibaMcpManager"], async scope => {
    await scope.amibaMcpManager.access.retainConfigurations("connector-core", async () =>
      (await center.listConnects()).map(record => record.id));
  });
  applyConnectorsRemote(ctx, center);
  registerConnectAddTool(ctx, center);
  // Stop every live connect on plugin unload (a reload, or a full shutdown)
  // so no runtime, socket, or mcp registration is left orphaned behind a
  // torn-down amibaConnectors service.
  ctx.effect(() => () => center.stop(), "amiba-connector-core.center");
  await center.start();
}

export { activateConnectionWork, inspectConnectionWork, connectionWorkAccess } from "./connection-activation.js";
