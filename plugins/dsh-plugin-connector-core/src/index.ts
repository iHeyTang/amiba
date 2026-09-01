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

/**
 * Namespaces a provider-declared BASE mcp serverName (e.g. lark declares the
 * literal `"lark"`) into one unique per connect, so that two connects of the
 * same provider — each independently declaring that same base name — don't
 * collide in mcp-manager's registry. `registerManagedServer`'s async
 * registration REJECTS on a duplicate `serverName` (see
 * plugins/dsh-plugin-mcp-manager/src/manager.ts), which would otherwise
 * hard-fail the second connect's enable outright.
 *
 * `connectId` is always `connect-<uuid>` (see store.ts's `ConnectorStore`);
 * its `connect-` prefix carries no entropy, so it's stripped and only the
 * uuid's first 8 characters — always plain hex, never containing the uuid's
 * own `-` separators, which start at index 8 — are kept as a short,
 * effectively-unique-per-connect suffix.
 *
 * `sanitize` strips every character outside mcp-manager's own
 * `[A-Za-z0-9_-]` charset (covers a base containing dots/slashes, e.g. a
 * package-flavored id) from both pieces independently. The 32-char length
 * ceiling is then enforced by clamping the BASE ONLY, never the suffix —
 * `${base}-${suffix}`.slice(0, 32)` was tried first and rejected: for any
 * base long enough to push the combined length past 32 (any sanitized base
 * ≥24 chars starts losing suffix characters; ≥31 chars loses the suffix
 * entirely), a plain end-slice cuts the suffix off the right end instead of
 * the base, so two connects sharing that same long base would clamp to the
 * IDENTICAL name — silently defeating the whole point of namespacing and
 * hard-failing the second connect's registration. Reserving room for `-` +
 * the full suffix and clamping the base into whatever's left of the budget
 * (falling back to a single `"s"` placeholder if the base sanitizes to
 * nothing) guarantees the suffix — the actual per-connect entropy — always
 * survives at the tail, for every base length. Pure function of its two
 * inputs: same `base` + `connectId` always yields the same name (stable
 * across repeated applier runs for the same connect, e.g. the disable/enable
 * recovery below).
 *
 * Residual collision risk: two connects whose ids happen to share the same
 * first 8 hex characters would still collide (≈1 in 16^8, ~4.3 billion, for
 * any given pair of connects on the same provider+base — accepted as
 * negligible rather than spending more of the 32-char budget on entropy).
 * This is now the ONLY collision source — unlike the rejected base-clamped
 * approach above, a long or duplicate base can no longer cause one on its
 * own.
 */
export function namespacedMcpServerName(base: string, connectId: string): string {
  const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "");
  const suffix = sanitize(connectId.replace(/^connect-/, "")).slice(0, 8);
  const sanitizedBase = sanitize(base);
  // Room left for the base once "-" + the full suffix are reserved; always
  // ≥23 in practice (suffix is at most 8 chars) — Math.max(1, ...) is
  // defensive only, so a future change to the suffix length can never drive
  // this negative and empty out the base entirely.
  const baseBudget = Math.max(1, 32 - 1 - suffix.length);
  const clippedBase = sanitizedBase.slice(0, baseBudget) || "s";
  return `${clippedBase}-${suffix}`;
}

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
    apply: async (connect, decl) => {
      if (decl.kind !== "mcp")
        throw new Error(`unexpected_capability_kind:${decl.kind}`);
      const manager = ctx.reflect.get("amibaMcpManager");
      if (!manager) {
        // Soft-skip (see CapabilityUnavailableError's doc comment): this one
        // connect keeps running with every OTHER capability applied, just
        // without its mcp registration, recorded as a degraded status
        // rather than aborting the whole enable (or reporting a hard error
        // for what is, from the operator's perspective, a still-functional
        // connect missing one optional capability).
        //
        // Recovery once amibaMcpManager actually loads is NOT automatic for
        // an already-live connect: `registerProvider`'s reconciliation
        // (`startProviderConnects` in center.ts) only starts a connect
        // that's enabled but not yet live — a connect whose runtime is
        // already live with this capability soft-skipped stays exactly as
        // it is (skip included) no matter how many times the owning
        // provider re-registers afterward. The fix is a manual two-step
        // disable/enable: `setEnabled(id, false)` tears the whole connect
        // down (stopping its runtime and disposing every capability that
        // DID apply), then `setEnabled(id, true)` starts it fresh and
        // re-runs every capability decl from scratch — this "mcp" applier
        // included — so it re-checks `amibaMcpManager` availability at that
        // later point instead of replaying the earlier miss.
        throw new CapabilityUnavailableError("mcp_manager_unavailable");
      }
      const spec = {
        ...decl.spec,
        serverName: namespacedMcpServerName(decl.spec.serverName, connect.id),
      };
      return await manager.registerManagedServer(spec);
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
