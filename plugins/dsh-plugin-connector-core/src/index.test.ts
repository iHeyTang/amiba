import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorCenter } from "./center.js";
import { provisionCli, type CliProvisionHandle } from "./cli-provision.js";
import { apply } from "./index.js";
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
        const next = await mutate(store.get(key));
        if (next !== undefined)
          store.set(key, next as { kind: string; payload?: unknown });
        else store.delete(key);
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

describe("connector-core plugin apply() — cli capability applier wiring", () => {
  afterEach(() => {
    vi.mocked(provisionCli).mockReset();
  });

  it("routes a 'cli' capability decl through provisionCli on enable, and disposes its handle on disable", async () => {
    const config = await fakeApplyConfig();
    const dispose = vi.fn(async () => undefined);
    const handle: CliProvisionHandle = {
      binaryPath: "/managed/acme",
      wrapperPath: "/cli-root/wrappers/acme-cli.sh",
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
    const [spec, deps] = vi.mocked(provisionCli).mock.calls[0]!;
    expect(spec).toMatchObject({ id: "acme-cli", package: "@acme/cli", binary: "acme-cli" });
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
