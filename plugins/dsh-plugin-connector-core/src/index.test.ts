import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorCenter } from "./center.js";
import { provisionCli, type CliProvisionHandle } from "./cli-provision.js";
import { apply, connectInstanceKey, namespacedMcpServerName } from "./index.js";
import type { ConnectorHandle, ConnectorProvider, ConnectorRuntime } from "./types.js";

// Mocked (vitest hoists this above the imports above at transform time) so
// the "cli" applier wiring test below can assert exactly what index.ts's
// real "cli" applier passes to provisionCli, without going anywhere near a
// real PATH lookup, npm install, or filesystem write — those are
// cli-provision.test.ts's job, against a fully faked CliProvisionDeps.
// cli-provision.ts's only runtime export is provisionCli itself (everything
// else it exposes is type-only), so this factory is a complete replacement.
vi.mock("./cli-provision.js", () => ({ provisionCli: vi.fn() }));

// Regression for the whole-branch-review Critical finding: connector-core's
// apply() registered TWO Cordis services under the exact same key
// ("amibaConnectors") — once via its own `ctx.provide("amibaConnectors",
// center)`, and again via `AmibaConnectorsRemoteService`'s Service-base
// constructor (`super(ctx, "amibaConnectors")` in remote-service.ts, before
// the fix). Cordis 4.0.1's real `ReflectService#provide` throws on a
// duplicate name (see node_modules/@deepseek-ai/cordis lib/index.js:
// `if (this.store[key]) throw new Error('service "${name}" has been
// registered at <${...}>')`) — so on a real Context, apply() itself throws,
// the whole plugin fiber fails, and connector-core (and therefore lark)
// never activates. Every other test in this package builds `ConnectorCenter`
// directly with a permissive test double that never enforces this, so
// nothing else in the suite would have caught it.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * Minimal fake Cordis Context reproducing the ONE behavior that matters
 * here: `ctx.provide(name, value)` and `ctx.reflect.provide(name, value)`
 * share one underlying store (exactly like real cordis, where `ctx.provide`
 * is a mixin forwarding to `ctx.reflect.provide` — see
 * node_modules/@deepseek-ai/cordis lib/index.js's `this.mixin("reflect",
 * ["get", "set", "provide", ...])`) and throw when the same service name is
 * registered twice — matching `ReflectService#provide`'s real duplicate
 * check byte for byte. `TypertRemoteService`'s Service-base constructor only
 * ever touches `ctx.reflect.provide(name, self, check)` during construction
 * (verified against @deepseek-ai/cordis's Service class and confirmed by
 * remote-service.test.ts's own `fakeRemoteCtx` comment) — so this fake needs
 * nothing else from `ctx.reflect` to reproduce the collision faithfully.
 */
function fakeCordisCtx() {
  const store = new Map<string, unknown>();
  const provide = (name: string, value: unknown) => {
    if (store.has(name))
      throw new Error(`service "${name}" has been registered at <root>`);
    store.set(name, value);
  };
  const ctx = {
    reflect: { provide, get: (name: string) => store.get(name) },
    provide,
    effect: (callback: () => unknown) => {
      const cleanup = callback();
      return async () => {
        if (typeof cleanup === "function") await cleanup();
      };
    },
    // `apply()` also calls `ctx.logger("amiba-connector-core")` to pass a
    // logger into `seedAgentPresets` (see preset-seed.ts); a fresh temp
    // `agentPresetsRoot` below has no "restricted" directory yet, so the
    // seeder writes one and calls `.info` exactly once.
    logger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    // Never exercised: a fresh store has no rows, so center.start() at the
    // end of apply() finds nothing to reconcile and neither the messaging
    // center nor the credentials seam is ever called.
    amibaMessageCenter: {},
    credentials: {},
  };
  return { ctx, store };
}

/** Config for `apply()`: every temp dir it needs, all registered for
 * cleanup. `apply()` requires all four fields (root, agentPresetsRoot,
 * cliRoot, skillsRoot); the "cli" applier only ever reads cliRoot/skillsRoot
 * indirectly (they're forwarded into `realCliDeps(ctx, config)`, itself
 * never exercised while provisionCli is mocked — see the vi.mock above). */
async function fakeApplyConfig() {
  const [root, agentPresetsRoot, cliRoot, skillsRoot] = await Promise.all([
    mkdtemp(join(tmpdir(), "amiba-connector-apply-root-")),
    mkdtemp(join(tmpdir(), "amiba-connector-apply-presets-")),
    mkdtemp(join(tmpdir(), "amiba-connector-apply-cliroot-")),
    mkdtemp(join(tmpdir(), "amiba-connector-apply-skillsroot-")),
  ]);
  roots.push(root, agentPresetsRoot, cliRoot, skillsRoot);
  return { root, agentPresetsRoot, cliRoot, skillsRoot };
}

describe("connector-core plugin apply()", () => {
  it("registers the center and its Remote service under distinct Cordis service keys, without throwing on a real duplicate-registration guard", async () => {
    const config = await fakeApplyConfig();
    const { ctx, store } = fakeCordisCtx();

    await expect(apply(ctx as never, config)).resolves.toBeUndefined();

    expect(store.has("amibaConnectors")).toBe(true);
    expect(store.get("amibaConnectors")).toBeInstanceOf(ConnectorCenter);
    // The Remote service must live under its OWN key, distinct from
    // "amibaConnectors" (which the center itself already occupies) — the
    // fix's whole point. Its wire namespace still resolves to
    // "amibaConnectors" for the client (see remote.ts's descriptors and
    // remote-service.ts's `{ namespace: "amibaConnectors" }` option), but
    // that's a client-side concern this fake Context can't observe.
    expect(store.has("amibaConnectorsRemote")).toBe(true);
    expect(store.get("amibaConnectorsRemote")).not.toBe(
      store.get("amibaConnectors"),
    );
  });
});

function fakeMessageCenter() {
  const providers = new Map<string, { id: string }>();
  return {
    createChannel: vi.fn(
      async (input: { provider: string; name: string; agentPreset?: string }) => ({
        channel: { id: "channel-1", provider: input.provider, name: input.name },
        secret: "s3cret",
      }),
    ),
    acceptInbound: vi.fn(async () => ({
      accepted: true,
      duplicate: false,
      sessionId: "session-1",
    })),
    conversationForSession: vi.fn(async () => null),
    removeChannel: vi.fn(async () => true),
    registerProvider: vi.fn((provider: { id: string }) => {
      providers.set(provider.id, provider);
      return () => {
        providers.delete(provider.id);
      };
    }),
    listConversations: vi.fn(async () => []),
    unbindConversation: vi.fn(async () => true),
  };
}

function fakeCredentials() {
  const store = new Map<string, { kind: string; payload?: unknown }>();
  return {
    readRecord: vi.fn(async (key: string) => store.get(key)),
    modifyRecord: vi.fn(
      async (
        key: string,
        mutate: (
          current: { kind: string; payload?: unknown } | undefined,
        ) => Promise<unknown>,
      ) => {
        const current = store.get(key);
        const next = await mutate(current);
        // Matches the real seam (@deepseek-ai/dsh-credentials-local's
        // modifyRecord): a mutate that resolves to undefined declines the
        // write and leaves the existing record untouched — it does not
        // delete. Explicit removal goes through deleteRecord.
        if (next === undefined) return current;
        store.set(key, next as { kind: string; payload?: unknown });
        return next;
      },
    ),
    deleteRecord: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

/** Same duplicate-registration-guard fake as `fakeCordisCtx`, but wired to
 * real (fake) messaging + credentials seams instead of the never-exercised
 * stubs, so a test can drive a full registerProvider → createConnect →
 * setEnabled(false) flow through the real center `apply()` produces. */
function fakeCordisCtxWithMessaging(
  messageCenter: ReturnType<typeof fakeMessageCenter>,
  credentials: ReturnType<typeof fakeCredentials>,
) {
  const store = new Map<string, unknown>();
  const provide = (name: string, value: unknown) => {
    if (store.has(name))
      throw new Error(`service "${name}" has been registered at <root>`);
    store.set(name, value);
  };
  const ctx = {
    reflect: { provide, get: (name: string) => store.get(name) },
    provide,
    effect: (callback: () => unknown) => {
      const cleanup = callback();
      return async () => {
        if (typeof cleanup === "function") await cleanup();
      };
    },
    logger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    amibaMessageCenter: messageCenter,
    credentials,
  };
  return { ctx, store };
}

function fakeCliProvider(id = "fake-cli") {
  const runtimes: Array<{
    stop: ReturnType<typeof vi.fn>;
    deliver: ReturnType<typeof vi.fn>;
  }> = [];
  const start = vi.fn(async (_handle: ConnectorHandle) => {
    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    } as unknown as ConnectorRuntime;
    runtimes.push(runtime as never);
    return runtime;
  });
  const provider: ConnectorProvider = {
    id,
    name: "Fake CLI Connector",
    description: "Fake connector declaring a cli capability",
    configSchema: {},
    validate: vi.fn(async () => undefined),
    start,
    capabilities: vi.fn(() => [
      {
        kind: "cli" as const,
        spec: {
          id: "acme-cli",
          package: "@acme/cli",
          binary: "acme-cli",
          minVersion: "1.0.0",
          pinnedVersion: "1.0.0",
          env: {},
          skills: [],
        },
      },
    ]),
  };
  return { provider, runtimes };
}

/** Fake `amibaMcpManager`: tracks every `registerManagedServer` call (spec
 * included) so a test can inspect exactly what serverName the real "mcp"
 * applier in index.ts computed and passed through. */
function fakeMcpManager() {
  const disposers: Array<ReturnType<typeof vi.fn>> = [];
  const registerManagedServer = vi.fn(async (_spec: unknown) => {
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  return { registerManagedServer, disposers };
}

/** A `ConnectorProvider` declaring one "mcp" capability with the given BASE
 * serverName — unnamespaced, exactly as a real provider (e.g. lark
 * declaring the literal `"lark"`) would. `capabilities()` is a fresh
 * closure per call, so calling it again for a second connect yields an
 * identical (still-unnamespaced) spec — namespacing only happens inside the
 * real "mcp" applier under test. */
function fakeMcpProvider(id = "fake-mcp", baseServerName = "acme") {
  const runtimes: Array<{
    stop: ReturnType<typeof vi.fn>;
    deliver: ReturnType<typeof vi.fn>;
  }> = [];
  const start = vi.fn(async (_handle: ConnectorHandle) => {
    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    } as unknown as ConnectorRuntime;
    runtimes.push(runtime as never);
    return runtime;
  });
  const provider: ConnectorProvider = {
    id,
    name: "Fake MCP Connector",
    description: "Fake connector declaring an mcp capability",
    configSchema: {},
    validate: vi.fn(async () => undefined),
    start,
    capabilities: vi.fn(() => [
      {
        kind: "mcp" as const,
        spec: {
          serverName: baseServerName,
          transport: "stdio" as const,
          command: "echo",
          args: [],
          env: {},
          enabled: true,
        },
      },
    ]),
  };
  return { provider, runtimes };
}

describe("connector-core plugin apply() — mcp capability applier wiring", () => {
  it("namespaces each connect's mcp serverName: two connects of the same provider declaring the same base name register DISTINCT, charset-valid serverNames", async () => {
    const config = await fakeApplyConfig();
    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const { ctx, store } = fakeCordisCtxWithMessaging(messageCenter, credentials);
    const mcpManager = fakeMcpManager();
    // The real "mcp" applier resolves amibaMcpManager lazily (`ctx.reflect.get`)
    // at capability-apply time, not at plugin load — see index.ts's comment
    // on the "mcp" applier — so it only needs to be on the store before the
    // first createConnect below, not before apply() itself.
    store.set("amibaMcpManager", mcpManager);

    await apply(ctx as never, config);
    const center = store.get("amibaConnectors") as ConnectorCenter;

    const { provider } = fakeMcpProvider("fake-mcp", "acme");
    center.registerProvider(provider);

    const viewA = await center.createConnect({
      provider: "fake-mcp",
      name: "Connect A",
      config: {},
      agentPreset: "restricted",
    });
    const viewB = await center.createConnect({
      provider: "fake-mcp",
      name: "Connect B",
      config: {},
      agentPreset: "restricted",
    });

    expect(mcpManager.registerManagedServer).toHaveBeenCalledTimes(2);
    // A successful applier application never surfaces an error status — both
    // connects' registrations landed cleanly, distinct names included.
    expect(viewA.status).toEqual({ state: "connecting" });
    expect(viewB.status).toEqual({ state: "connecting" });

    const serverNames = mcpManager.registerManagedServer.mock.calls.map(
      ([spec]) => (spec as { serverName: string }).serverName,
    );
    expect(new Set(serverNames).size).toBe(2);
    for (const serverName of serverNames) {
      expect(serverName).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
      expect(serverName.startsWith("acme-")).toBe(true);
    }
  });

  it("skips (soft) and hard-fails nothing else when amibaMcpManager isn't wired in, recording a degraded status", async () => {
    const config = await fakeApplyConfig();
    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const { ctx, store } = fakeCordisCtxWithMessaging(messageCenter, credentials);
    // No "amibaMcpManager" entry on the store at all.

    await apply(ctx as never, config);
    const center = store.get("amibaConnectors") as ConnectorCenter;

    const { provider, runtimes } = fakeMcpProvider("fake-mcp", "acme");
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake-mcp",
      name: "No manager",
      config: {},
      agentPreset: "restricted",
    });

    expect(view.status).toMatchObject({
      state: "degraded",
      detail: "mcp_manager_unavailable",
    });
    // The soft-skip must not unwind the runtime that already started.
    expect(runtimes[0]!.stop).not.toHaveBeenCalled();
  });
});

describe("namespacedMcpServerName", () => {
  const CONNECT_ID = "connect-3f9a1b2c-dead-4bee-8000-000000000000";

  it("appends a sanitized 8-char connect-id suffix to the base name", () => {
    expect(namespacedMcpServerName("lark", CONNECT_ID)).toBe("lark-3f9a1b2c");
  });

  it("strips characters outside [A-Za-z0-9_-] from the base (dots, slashes)", () => {
    const name = namespacedMcpServerName("acme.cli/v2", CONNECT_ID);
    expect(name).toBe("acmecliv2-3f9a1b2c");
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it("clamps the BASE (never the suffix) to mcp-manager's 32-char ceiling — the suffix survives intact at the tail", () => {
    const longBase = "a".repeat(40);
    const name = namespacedMcpServerName(longBase, CONNECT_ID);
    expect(name.length).toBe(32);
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    // The full 8-char suffix must still be present at the tail — a
    // plain end-slice of "base-suffix" would have cut it off instead of
    // the (over-long) base.
    expect(name.endsWith("-3f9a1b2c")).toBe(true);
    expect(name).toBe(`${"a".repeat(23)}-3f9a1b2c`);
  });

  it("is stable: the same base + connect id always produce the same serverName", () => {
    const first = namespacedMcpServerName("lark", CONNECT_ID);
    const second = namespacedMcpServerName("lark", CONNECT_ID);
    expect(first).toBe(second);
  });

  it("still produces a valid, non-empty serverName when the base sanitizes to empty", () => {
    const name = namespacedMcpServerName("...", CONNECT_ID);
    // Falls back to a single "s" placeholder rather than a bare
    // leading "-<suffix>" — see the function's doc comment.
    expect(name).toBe("s-3f9a1b2c");
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  it("two different connect ids sharing the provider's base name produce two different results", () => {
    const other = "connect-abcdef01-0000-4000-8000-000000000000";
    expect(namespacedMcpServerName("lark", CONNECT_ID)).not.toBe(
      namespacedMcpServerName("lark", other),
    );
  });

  // Regression for the review-Critical finding: a plain end-slice of
  // "base-suffix" collides two connects that share the same over-long base,
  // because the slice cuts the SUFFIX off instead of the base — which would
  // make the second connect's registerManagedServer call reject as a
  // duplicate and hard-fail its enable. Clamping the base only (never the
  // suffix) must keep two such connects distinct.
  it("two connects sharing the SAME 40-char base still produce DISTINCT, regex-valid, ≤32-char names with the suffix intact at the tail", () => {
    const longBase = "b".repeat(40);
    const connectA = "connect-11112222-0000-4000-8000-000000000000";
    const connectB = "connect-99998888-0000-4000-8000-000000000000";

    const nameA = namespacedMcpServerName(longBase, connectA);
    const nameB = namespacedMcpServerName(longBase, connectB);

    expect(nameA).not.toBe(nameB);
    for (const name of [nameA, nameB]) {
      expect(name.length).toBeLessThanOrEqual(32);
      expect(name).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    }
    expect(nameA.endsWith("-11112222")).toBe(true);
    expect(nameB.endsWith("-99998888")).toBe(true);
  });
});

describe("connector-core plugin apply() — cli capability applier wiring", () => {
  afterEach(() => {
    vi.mocked(provisionCli).mockReset();
  });

  it("routes a 'cli' capability decl through provisionCli on enable, with a derived per-connect instance, and disposes its handle on disable", async () => {
    const config = await fakeApplyConfig();
    const dispose = vi.fn(async () => undefined);
    const handle: CliProvisionHandle = {
      binaryPath: "/managed/acme",
      wrapperPath: "/cli-root/wrappers/acme-cli-abcd1234.sh",
      skillPath: "/skills-root/acme-cli-abcd1234/SKILL.md",
      seededSkills: [],
      dispose,
    };
    vi.mocked(provisionCli).mockResolvedValue(handle);

    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const { ctx, store } = fakeCordisCtxWithMessaging(messageCenter, credentials);

    await apply(ctx as never, config);
    const center = store.get("amibaConnectors") as ConnectorCenter;

    const { provider } = fakeCliProvider();
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake-cli",
      name: "CLI test",
      config: {},
      agentPreset: "restricted",
    });

    expect(provisionCli).toHaveBeenCalledTimes(1);
    const [spec, instance, deps] = vi.mocked(provisionCli).mock.calls[0]!;
    expect(spec).toMatchObject({ id: "acme-cli", package: "@acme/cli", binary: "acme-cli" });
    // The instance identity is derived by the applier itself (never the
    // provider-declared spec) — see connectInstanceKey's doc comment.
    expect(instance).toEqual({
      id: connectInstanceKey("acme-cli", view.id),
      connectName: "CLI test",
      provider: "fake-cli",
    });
    expect(deps).toMatchObject({
      cliRoot: config.cliRoot,
      skillsRoot: config.skillsRoot,
    });
    // A successful applier application never surfaces an error status.
    expect(view.status).toEqual({ state: "connecting" });
    expect(dispose).not.toHaveBeenCalled();

    await center.setEnabled(view.id, false);

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("derives a distinct instanceId per connect via connectInstanceKey, even though every connect of the same provider declares the identical decl.spec.id", async () => {
    const config = await fakeApplyConfig();
    vi.mocked(provisionCli).mockImplementation(async (_spec, instance) => ({
      binaryPath: `/managed/${instance.id}`,
      wrapperPath: `/cli-root/wrappers/${instance.id}.sh`,
      skillPath: `/skills-root/${instance.id}/SKILL.md`,
      seededSkills: [],
      dispose: vi.fn(async () => undefined),
    }));

    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const { ctx, store } = fakeCordisCtxWithMessaging(messageCenter, credentials);

    await apply(ctx as never, config);
    const center = store.get("amibaConnectors") as ConnectorCenter;

    const { provider } = fakeCliProvider();
    center.registerProvider(provider);

    const viewA = await center.createConnect({
      provider: "fake-cli",
      name: "Connect A",
      config: {},
      agentPreset: "restricted",
    });
    const viewB = await center.createConnect({
      provider: "fake-cli",
      name: "Connect B",
      config: {},
      agentPreset: "restricted",
    });

    expect(provisionCli).toHaveBeenCalledTimes(2);
    const [specA, instanceA] = vi.mocked(provisionCli).mock.calls[0]!;
    const [specB, instanceB] = vi.mocked(provisionCli).mock.calls[1]!;

    // Both connects declare the exact same provider spec.id — that's the
    // whole premise of the collision this fix closes: namespacing cannot
    // come from spec.id itself, only from the applier combining it with
    // each connect's own id.
    expect(specA.id).toBe("acme-cli");
    expect(specB.id).toBe("acme-cli");

    expect(instanceA.id).toBe(connectInstanceKey("acme-cli", viewA.id));
    expect(instanceB.id).toBe(connectInstanceKey("acme-cli", viewB.id));
    expect(instanceA.id).not.toBe(instanceB.id);
    expect(instanceA).toMatchObject({ connectName: "Connect A", provider: "fake-cli" });
    expect(instanceB).toMatchObject({ connectName: "Connect B", provider: "fake-cli" });

    // A successful applier application never surfaces an error status.
    expect(viewA.status).toEqual({ state: "connecting" });
    expect(viewB.status).toEqual({ state: "connecting" });
  });

  it("disposing one connect's runtime disposes only its own provisionCli handle — the other connect's handle is untouched", async () => {
    const config = await fakeApplyConfig();
    const disposeA = vi.fn(async () => undefined);
    const disposeB = vi.fn(async () => undefined);
    const handleA: CliProvisionHandle = {
      binaryPath: "/managed/a",
      wrapperPath: "/cli-root/wrappers/instance-a.sh",
      skillPath: "/skills-root/instance-a/SKILL.md",
      seededSkills: [],
      dispose: disposeA,
    };
    const handleB: CliProvisionHandle = {
      binaryPath: "/managed/b",
      wrapperPath: "/cli-root/wrappers/instance-b.sh",
      skillPath: "/skills-root/instance-b/SKILL.md",
      seededSkills: [],
      dispose: disposeB,
    };
    vi.mocked(provisionCli).mockResolvedValueOnce(handleA).mockResolvedValueOnce(handleB);

    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const { ctx, store } = fakeCordisCtxWithMessaging(messageCenter, credentials);

    await apply(ctx as never, config);
    const center = store.get("amibaConnectors") as ConnectorCenter;

    const { provider } = fakeCliProvider();
    center.registerProvider(provider);

    const viewA = await center.createConnect({
      provider: "fake-cli",
      name: "Connect A",
      config: {},
      agentPreset: "restricted",
    });
    await center.createConnect({
      provider: "fake-cli",
      name: "Connect B",
      config: {},
      agentPreset: "restricted",
    });

    await center.setEnabled(viewA.id, false);

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).not.toHaveBeenCalled();
  });

  it("a provisionCli rejection hard-fails the enable (propagates, same as any other capability applier)", async () => {
    const config = await fakeApplyConfig();
    vi.mocked(provisionCli).mockRejectedValue(new Error("npm_install_failed"));

    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const { ctx, store } = fakeCordisCtxWithMessaging(messageCenter, credentials);

    await apply(ctx as never, config);
    const center = store.get("amibaConnectors") as ConnectorCenter;

    const { provider, runtimes } = fakeCliProvider();
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake-cli",
      name: "CLI test",
      config: {},
      agentPreset: "restricted",
    });

    expect(view.status).toMatchObject({ state: "error", detail: "npm_install_failed" });
    // A hard-fail unwinds the runtime that already started, same as the
    // "unknown capability kind" contract center.test.ts covers for "mcp".
    expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
  });
});
