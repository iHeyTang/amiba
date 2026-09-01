import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MessageChannelProvider } from "@amiba/dsh-plugin-messaging-core";

import { CapabilityUnavailableError, ConnectorCenter } from "./center.js";
import { ConnectorStore, type StoredConnect } from "./store.js";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorProvider,
  ConnectorRuntime,
  OnboardHandle,
  OnboardResult,
} from "./types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function fakeMessageCenter() {
  const providers = new Map<string, MessageChannelProvider>();
  const acceptInboundCalls: Array<{
    channelId: string;
    secret: string;
    envelope: unknown;
  }> = [];
  const removeChannelCalls: string[] = [];
  const createChannel = vi.fn(
    async (input: {
      provider: string;
      name: string;
      agentPreset?: string;
      sessionId?: string;
    }) => {
      // Mirrors the real MessageChannelCenter.createChannel, which rejects
      // when neither a sessionId nor an agentPreset is given.
      if (!input.agentPreset?.trim() && !input.sessionId?.trim())
        throw new Error("invalid_channel");
      return {
        channel: { id: "channel-1", provider: input.provider, name: input.name },
        secret: "s3cret",
      };
    },
  );
  const acceptInbound = vi.fn(
    async (channelId: string, secret: string, envelope: unknown) => {
      acceptInboundCalls.push({ channelId, secret, envelope });
      return { accepted: true, duplicate: false, sessionId: "session-1" };
    },
  );
  const conversationForSession = vi.fn(
    async (channelId: string, sessionId: string) => ({
      conversationKey: "chat-1",
      kind: "p2p" as const,
      channelId,
      sessionId,
    }),
  );
  const removeChannel = vi.fn(async (channelId: string) => {
    removeChannelCalls.push(channelId);
    return true;
  });
  const registerProvider = vi.fn((provider: MessageChannelProvider) => {
    // Mirrors the real MessageChannelCenter.registerProvider (center.ts:287-288),
    // which throws on a duplicate provider id instead of silently overwriting
    // it — a plain overwrite here would hide the reload race Fix 2 guards
    // against (the real center genuinely throws when a reload re-registers
    // the same bridge id while the old registration is still torn down).
    if (providers.has(provider.id))
      throw new Error(`duplicate channel provider ${provider.id}`);
    providers.set(provider.id, provider);
    return () => {
      providers.delete(provider.id);
    };
  });
  return {
    providers,
    createChannel,
    acceptInbound,
    acceptInboundCalls,
    conversationForSession,
    removeChannel,
    removeChannelCalls,
    registerProvider,
    listConversations: vi.fn(async () => []),
    unbindConversation: vi.fn(async () => true),
  };
}

function fakeCredentials() {
  const store = new Map<string, { kind: string; payload?: unknown }>();
  return {
    store,
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

function fakeMcpManager() {
  const disposers: Array<ReturnType<typeof vi.fn>> = [];
  const registerManagedServer = vi.fn(async (_spec: unknown) => {
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  return { registerManagedServer, disposers };
}

const DEFAULT_CAPABILITIES: CapabilityDecl[] = [
  {
    kind: "mcp",
    spec: {
      serverName: "conn-fake",
      transport: "stdio",
      command: "echo",
      args: [],
      env: {},
      enabled: true,
    },
  },
];

function fakeProvider(
  capabilities: CapabilityDecl[] = DEFAULT_CAPABILITIES,
  id = "fake",
) {
  const starts: ConnectorHandle[] = [];
  const runtimes: Array<{
    stop: ReturnType<typeof vi.fn>;
    deliver: ReturnType<typeof vi.fn>;
  }> = [];
  const validate = vi.fn(async () => undefined);
  const start = vi.fn(async (handle: ConnectorHandle) => {
    starts.push(handle);
    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    } as unknown as ConnectorRuntime;
    runtimes.push(runtime as never);
    return runtime;
  });
  const provider: ConnectorProvider = {
    id,
    name: "Fake Connector",
    description: "Fake connector for tests",
    configSchema: {},
    validate,
    start,
    capabilities: vi.fn(() => capabilities),
  };
  return { provider, starts, runtimes, validate, start };
}

/**
 * A `fakeProvider` plus a controllable `onboard()`: the deferred promise
 * lets a test decide exactly when the flow resolves/rejects, and the
 * captured handle exposes `signal`/`emit` for assertions (e.g. "did the
 * provider see the abort").
 */
function fakeOnboardingProvider(id = "fake-onboard") {
  const base = fakeProvider(undefined, id);
  const gate = deferred<OnboardResult>();
  let handle: OnboardHandle | undefined;
  const onboard = vi.fn(async (h: OnboardHandle) => {
    handle = h;
    return gate.promise;
  });
  const provider: ConnectorProvider = { ...base.provider, onboard };
  return { ...base, provider, onboard, gate, getHandle: () => handle };
}

/**
 * Builds a fresh appliers map mirroring index.ts's real "mcp" applier: always
 * registered, resolving manager availability at apply time rather than at
 * plugin-load time. `withMcpManager: false` simulates the manager not being
 * wired into this runtime.
 */
function fakeAppliers(
  mcp: ReturnType<typeof fakeMcpManager>,
  withMcpManager: boolean,
) {
  const appliers = new Map<
    string,
    { apply: (connect: StoredConnect, decl: CapabilityDecl) => Promise<() => void> }
  >();
  appliers.set("mcp", {
    apply: async (_connect, decl) => {
      if (decl.kind !== "mcp") throw new Error("unexpected_kind");
      if (!withMcpManager)
        throw new CapabilityUnavailableError("mcp_manager_unavailable");
      return mcp.registerManagedServer(decl.spec);
    },
  });
  return appliers;
}

/** A promise plus its resolvers, exposed for tests that need to control
 * exactly when an in-flight async operation (e.g. `provider.start`)
 * settles, so they can observe center state while it's mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function harness(options?: {
  withMcpManager?: boolean;
  now?: () => number;
}) {
  const root = await mkdtemp(join(tmpdir(), "amiba-connector-center-"));
  roots.push(root);
  const store = new ConnectorStore(root);
  const messageCenter = fakeMessageCenter();
  const credentials = fakeCredentials();
  const mcp = fakeMcpManager();
  const appliers = fakeAppliers(mcp, options?.withMcpManager !== false);
  const ctx = { logger: () => ({ error: vi.fn() }) };
  const center = new ConnectorCenter(
    ctx as never,
    store,
    messageCenter as never,
    credentials as never,
    appliers,
    options?.now,
  );
  return { root, store, messageCenter, credentials, mcp, appliers, ctx, center };
}

describe("ConnectorCenter", () => {
  it("registers a provider and exposes a messaging bridge provider", async () => {
    const { center, messageCenter } = await harness();
    const { provider } = fakeProvider();

    const dispose = center.registerProvider(provider);

    expect(messageCenter.registerProvider).toHaveBeenCalledTimes(1);
    expect(messageCenter.registerProvider.mock.calls[0]?.[0]).toMatchObject({
      id: "connector-fake",
      name: "Fake Connector",
      description: "Fake connector for tests",
      supportsInbound: true,
      supportsOutbound: true,
    });
    expect(center.listProviders()).toEqual([
      {
        id: "fake",
        name: "Fake Connector",
        description: "Fake connector for tests",
        supportsOnboarding: false,
      },
    ]);

    dispose();

    // The provider entry is removed synchronously, but the messaging bridge
    // is only dropped once stopProviderConnects() resolves (fire-and-forget
    // behind the disposer, so no live connects are orphaned mid-teardown).
    expect(center.listProviders()).toEqual([]);
    await vi.waitFor(() => {
      expect(messageCenter.providers.has("connector-fake")).toBe(false);
    });
  });

  it("createConnect validates, persists grant + channel, and starts the runtime", async () => {
    const { center, credentials, mcp, store } = await harness();
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);

    const config = { token: "abc" };
    const view = await center.createConnect({
      provider: "fake",
      name: "My Connect",
      config,
      agentPreset: "restricted",
    });

    expect(provider.validate).toHaveBeenCalledWith(config);
    expect(view.channelId).toBe("channel-1");
    expect(view.status).toEqual({ state: "connecting" });

    const grant = credentials.store.get(`amiba-connector-core/${view.id}`);
    expect(grant).toMatchObject({
      kind: "grant",
      payload: { config, channelSecret: "s3cret" },
    });
    // Config and the channel secret live only in the credentials seam —
    // never in the JSON-backed connect store.
    const stored = JSON.stringify(await store.list());
    expect(stored).not.toContain("s3cret");
    expect(stored).not.toContain("abc");

    expect(starts).toHaveLength(1);
    expect(mcp.registerManagedServer).toHaveBeenCalledWith(
      expect.objectContaining({ serverName: "conn-fake" }),
    );

    starts[0]!.setStatus({ state: "ready" });
    const [reloaded] = await center.listConnects();
    expect(reloaded!.status).toEqual({ state: "ready" });
  });

  it("createConnect rejects an empty agentPreset before anything is persisted", async () => {
    const { center, store, credentials } = await harness();
    const { provider } = fakeProvider();
    center.registerProvider(provider);

    await expect(
      center.createConnect({
        provider: "fake",
        name: "No preset",
        config: {},
        agentPreset: "   ",
      }),
    ).rejects.toThrow("agent_preset_required");

    expect(await store.list()).toHaveLength(0);
    expect(credentials.store.size).toBe(0);
  });

  it("pairing admits the first sender as owner and drops strangers silently", async () => {
    const { center, messageCenter, store } = await harness();
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Pairing",
      config: {},
      agentPreset: "restricted",
    });
    const handle = starts[0]!;

    await handle.onInbound({
      id: "m1",
      text: "hi",
      sender: "alice",
      conversation: { key: "c1", kind: "p2p" },
    });
    expect(messageCenter.acceptInbound).toHaveBeenCalledTimes(1);
    expect(messageCenter.acceptInbound).toHaveBeenCalledWith(
      "channel-1",
      "s3cret",
      expect.objectContaining({ id: "m1" }),
    );

    const afterFirst = (await store.list()).find((row) => row.id === view.id);
    expect(afterFirst?.owners).toEqual(["alice"]);
    expect(afterFirst?.pairing).toBe(false);

    await handle.onInbound({
      id: "m2",
      text: "hi again",
      sender: "bob",
      conversation: { key: "c1", kind: "p2p" },
    });
    expect(messageCenter.acceptInbound).toHaveBeenCalledTimes(1);

    await expect(
      handle.onInbound({
        id: "m3",
        text: "no sender",
        conversation: { key: "c1", kind: "p2p" },
      }),
    ).resolves.toBeUndefined();
    expect(messageCenter.acceptInbound).toHaveBeenCalledTimes(1);
  });

  it("setOwners ends pairing: manual owner configuration is not superseded by the next inbound sender", async () => {
    const { center, messageCenter, store } = await harness();
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Manual owners",
      config: {},
      agentPreset: "restricted",
    });
    const handle = starts[0]!;

    const before = (await store.list()).find((row) => row.id === view.id);
    expect(before?.pairing).toBe(true);

    const updated = await center.setOwners(view.id, ["alice"]);
    expect(updated.pairing).toBe(false);
    expect(updated.owners).toEqual(["alice"]);

    const afterSet = (await store.list()).find((row) => row.id === view.id);
    expect(afterSet?.pairing).toBe(false);
    expect(afterSet?.owners).toEqual(["alice"]);

    // A stranger's inbound message must be dropped, not silently admitted
    // as a claimed owner — pairing already ended via manual configuration,
    // so it must never wipe out (or add to) what was just set.
    await handle.onInbound({
      id: "m1",
      text: "hi",
      sender: "mallory",
      conversation: { key: "c1", kind: "p2p" },
    });
    expect(messageCenter.acceptInbound).not.toHaveBeenCalled();
    const afterInbound = (await store.list()).find((row) => row.id === view.id);
    expect(afterInbound?.owners).toEqual(["alice"]);
  });

  it("pairing claims are atomic under concurrent first messages", async () => {
    const { center, messageCenter, store } = await harness();
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Pairing race",
      config: {},
      agentPreset: "restricted",
    });
    const handle = starts[0]!;

    // Two "first" senders arrive concurrently during pairing. A plain
    // read-then-write gate would let both pass (both observe pairing: true
    // before either writes); the compare-and-set claim must admit exactly
    // one and drop the other.
    await Promise.all([
      handle.onInbound({
        id: "m1",
        text: "hi",
        sender: "alice",
        conversation: { key: "c1", kind: "p2p" },
      }),
      handle.onInbound({
        id: "m2",
        text: "hi",
        sender: "mallory",
        conversation: { key: "c1", kind: "p2p" },
      }),
    ]);

    expect(messageCenter.acceptInbound).toHaveBeenCalledTimes(1);

    const row = (await store.list()).find((item) => item.id === view.id);
    expect(row?.pairing).toBe(false);
    expect(row?.owners).toHaveLength(1);
    expect(["alice", "mallory"]).toContain(row?.owners[0]);

    const acceptedEnvelope = messageCenter.acceptInbound.mock.calls[0]?.[2] as
      | { sender?: string }
      | undefined;
    expect(acceptedEnvelope?.sender).toBe(row?.owners[0]);
  });

  it("bridge deliver requires a live runtime and passes the conversation ref", async () => {
    const { center, messageCenter } = await harness();
    const { provider, runtimes } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Bridge",
      config: {},
      agentPreset: "restricted",
    });

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.deliver) throw new Error("bridge provider missing deliver");
    const envelope = {
      id: "o1",
      channelId: "channel-1",
      sessionId: "session-1",
      inReplyTo: "m1",
      text: "reply",
      createdAt: new Date().toISOString(),
    };

    await bridge.deliver({ id: "channel-1" } as never, envelope);
    expect(runtimes[0]!.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ key: "chat-1", kind: "p2p" }),
      envelope,
    );

    await center.setEnabled(view.id, false);
    await expect(
      bridge.deliver({ id: "channel-1" } as never, envelope),
    ).rejects.toThrow();
  });

  it("disable unwinds runtime and capability disposers; remove deletes grant and channel", async () => {
    const { center, credentials, messageCenter, mcp } = await harness();
    const { provider, runtimes } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Lifecycle",
      config: {},
      agentPreset: "restricted",
    });

    expect(runtimes).toHaveLength(1);
    expect(mcp.disposers).toHaveLength(1);

    await center.setEnabled(view.id, false);
    expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
    expect(mcp.disposers[0]).toHaveBeenCalledTimes(1);
    const disabled = (await center.listConnects())[0]!;
    expect(disabled.enabled).toBe(false);

    await center.setEnabled(view.id, true);
    expect(runtimes).toHaveLength(2);
    expect(mcp.disposers).toHaveLength(2);

    const removed = await center.removeConnect(view.id);
    expect(removed).toBe(true);
    expect(runtimes[1]!.stop).toHaveBeenCalledTimes(1);
    expect(mcp.disposers[1]).toHaveBeenCalledTimes(1);
    expect(credentials.store.has(`amiba-connector-core/${view.id}`)).toBe(false);
    expect(messageCenter.removeChannelCalls).toContain("channel-1");
    expect(await center.listConnects()).toHaveLength(0);
  });

  it("concurrent double-enable starts the runtime only once", async () => {
    const { center } = await harness();
    const { provider, start } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Double enable",
      config: {},
      agentPreset: "restricted",
    });
    await center.setEnabled(view.id, false);
    start.mockClear();

    // Two concurrent enables must not both observe enabled:false and both
    // start a runtime — the second must join the first's in-flight start
    // (or see it already live) instead of leaking a duplicate.
    await Promise.all([
      center.setEnabled(view.id, true),
      center.setEnabled(view.id, true),
    ]);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("start() recovers enabled connects at boot, tolerating a per-connect failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-connector-center-"));
    roots.push(root);
    const store = new ConnectorStore(root);
    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const mcp = fakeMcpManager();
    const appliers = fakeAppliers(mcp, true);
    const ctx = { logger: () => ({ error: vi.fn() }) };
    const center = new ConnectorCenter(
      ctx as never,
      store,
      messageCenter as never,
      credentials as never,
      appliers,
    );

    // One connect whose provider declares a capability kind nothing can
    // apply (hard failure), one that starts cleanly. The bad row is created
    // first so an unguarded start() loop that aborts on the first failure
    // would prove itself by never reaching the good row.
    const { provider: badProvider, runtimes: badRuntimes } = fakeProvider(
      [
        {
          kind: "cli",
          spec: {
            id: "x",
            package: "y",
            binary: "y",
            minVersion: "1.0.0",
            pinnedVersion: "1.0.0",
            env: {},
            skills: [],
          },
        },
      ],
      "bad",
    );
    const { provider: goodProvider } = fakeProvider(undefined, "good");
    center.registerProvider(badProvider);
    center.registerProvider(goodProvider);

    const badRow = await store.create({
      provider: "bad",
      name: "Bad boot",
      agentPreset: "restricted",
    });
    await credentials.modifyRecord(
      `amiba-connector-core/${badRow.id}`,
      async () => ({
        kind: "grant",
        payload: { config: {}, channelSecret: "bad-secret" },
      }),
    );
    await store.update(badRow.id, { channelId: "channel-bad" });

    const goodRow = await store.create({
      provider: "good",
      name: "Good boot",
      agentPreset: "restricted",
    });
    await credentials.modifyRecord(
      `amiba-connector-core/${goodRow.id}`,
      async () => ({
        kind: "grant",
        payload: { config: {}, channelSecret: "good-secret" },
      }),
    );
    await store.update(goodRow.id, { channelId: "channel-good" });

    await expect(center.start()).resolves.toBeUndefined();

    expect(badProvider.start).toHaveBeenCalledTimes(1);
    expect(badRuntimes[0]!.stop).toHaveBeenCalledTimes(1);
    expect(goodProvider.start).toHaveBeenCalledTimes(1);

    const views = await center.listConnects();
    const badView = views.find((view) => view.id === badRow.id);
    const goodView = views.find((view) => view.id === goodRow.id);
    expect(badView?.status).toMatchObject({ state: "error" });
    expect(goodView?.status).toEqual({ state: "connecting" });
  });

  it("unregistering a provider stops its live connects (runtimes + capability disposers)", async () => {
    const { center, mcp } = await harness();
    const { provider, runtimes } = fakeProvider();
    const dispose = center.registerProvider(provider);
    await center.createConnect({
      provider: "fake",
      name: "Orphan test",
      config: {},
      agentPreset: "restricted",
    });

    dispose();

    // The disposer contract is synchronous (`() => void`); teardown of the
    // provider's connects happens fire-and-forget behind it.
    await vi.waitFor(() => {
      expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
      expect(mcp.disposers[0]).toHaveBeenCalledTimes(1);
    });
  });

  it("center.stop() stops every live connect", async () => {
    const { center } = await harness();
    const { provider: providerA, runtimes: runtimesA } = fakeProvider(
      undefined,
      "fake-a",
    );
    const { provider: providerB, runtimes: runtimesB } = fakeProvider(
      undefined,
      "fake-b",
    );
    center.registerProvider(providerA);
    center.registerProvider(providerB);
    await center.createConnect({
      provider: "fake-a",
      name: "A",
      config: {},
      agentPreset: "restricted",
    });
    await center.createConnect({
      provider: "fake-b",
      name: "B",
      config: {},
      agentPreset: "restricted",
    });

    await center.stop();

    expect(runtimesA[0]!.stop).toHaveBeenCalledTimes(1);
    expect(runtimesB[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("an unknown capability kind fails enable and surfaces an error status", async () => {
    const { center } = await harness();
    const { provider, runtimes } = fakeProvider([
      {
        kind: "cli",
        spec: {
          id: "x",
          package: "y",
          binary: "y",
          minVersion: "1.0.0",
          pinnedVersion: "1.0.0",
          env: {},
          skills: [],
        },
      },
    ]);
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake",
      name: "Bad capability",
      config: {},
      agentPreset: "restricted",
    });

    expect(view.status).toMatchObject({ state: "error" });
    // Exact, not just `.toContain`: the detail must be the bare Error
    // message, with no "Error: " prefix baked in (the status badge template
    // already adds its own "Error: " — a stored "Error: ..." would double
    // it up in the UI).
    expect((view.status as { detail?: string }).detail).toBe(
      "unknown_capability_kind:cli",
    );
    expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("skips a capability when its manager dependency is unavailable, without aborting the connect, recording a degraded (not error) status", async () => {
    const { center } = await harness({ withMcpManager: false });
    const { provider, runtimes } = fakeProvider();
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake",
      name: "No manager",
      config: {},
      agentPreset: "restricted",
    });

    expect(view.status).toEqual({
      state: "degraded",
      detail: "mcp_manager_unavailable",
    });
    expect(runtimes[0]!.stop).not.toHaveBeenCalled();
  });

  it("a registerManagedServer rejection hard-fails the connect (async-registration contract)", async () => {
    const { center, mcp } = await harness();
    const { provider, runtimes } = fakeProvider();
    center.registerProvider(provider);
    mcp.registerManagedServer.mockRejectedValueOnce(
      new Error("duplicate managed MCP server conn-fake"),
    );

    const view = await center.createConnect({
      provider: "fake",
      name: "Registration fails",
      config: {},
      agentPreset: "restricted",
    });

    expect(view.status).toMatchObject({ state: "error" });
    // Same bare-message contract as above: no doubled "Error: " prefix.
    expect((view.status as { detail?: string }).detail).toBe(
      "duplicate managed MCP server conn-fake",
    );
    expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("rolls back the channel, grant and row when provisioning fails before the runtime starts", async () => {
    const { center, credentials, messageCenter, store } = await harness();
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);

    credentials.modifyRecord.mockRejectedValueOnce(new Error("disk_full"));

    await expect(
      center.createConnect({
        provider: "fake",
        name: "Doomed",
        config: {},
        agentPreset: "restricted",
      }),
    ).rejects.toThrow("disk_full");

    // The channel was already created before the credential write failed, so
    // it must be torn down along with the (never-written) grant and row.
    expect(messageCenter.removeChannelCalls).toContain("channel-1");
    expect(credentials.store.size).toBe(0);
    expect(await store.list()).toHaveLength(0);
    // A provisioning failure never reaches the start fiber.
    expect(starts).toHaveLength(0);
  });

  it("stopConnect joins an in-flight start, so a disable racing a start doesn't leave a live relaying runtime", async () => {
    const { center, messageCenter } = await harness();
    const { provider, start, starts } = fakeProvider([]);
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake",
      name: "Racey",
      config: {},
      agentPreset: "restricted",
    });
    await center.setEnabled(view.id, false);
    start.mockClear();

    let resolveStart!: (runtime: ConnectorRuntime) => void;
    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    } as unknown as ConnectorRuntime;
    const deferredStart = new Promise<ConnectorRuntime>((resolve) => {
      resolveStart = resolve;
    });
    start.mockImplementationOnce(async (handle: ConnectorHandle) => {
      starts.push(handle);
      return deferredStart;
    });

    // Re-enable, but its provider.start() is stuck mid-flight (in
    // `this.starting`, not yet in `this.live`).
    const enablePromise = center.setEnabled(view.id, true);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    // A concurrent disable must join that in-flight start rather than
    // observing an empty `live` and returning early.
    const disablePromise = center.setEnabled(view.id, false);

    const acceptInboundCallsBefore = messageCenter.acceptInboundCalls.length;

    resolveStart(runtime);
    await Promise.all([enablePromise, disablePromise]);

    expect(runtime.stop).toHaveBeenCalledTimes(1);

    const disabledView = (await center.listConnects()).find(
      (item) => item.id === view.id,
    );
    expect(disabledView?.enabled).toBe(false);

    // No relaying: the joined start's handle must not still be wired to a
    // live connect.
    const racedHandle = starts[starts.length - 1]!;
    await racedHandle.onInbound({
      id: "late",
      text: "should not relay",
      sender: "alice",
      conversation: { key: "c1", kind: "p2p" },
    });
    expect(messageCenter.acceptInboundCalls.length).toBe(
      acceptInboundCallsBefore,
    );
  });

  it("disposing a provider registration stops that provider's connects before dropping the messaging bridge", async () => {
    const { center, messageCenter } = await harness();
    const { provider, runtimes } = fakeProvider([]);

    const sequence: string[] = [];
    const originalRegisterProvider =
      messageCenter.registerProvider.getMockImplementation()!;
    messageCenter.registerProvider.mockImplementation(
      (bridgeProvider: MessageChannelProvider) => {
        const dispose = originalRegisterProvider(bridgeProvider);
        return () => {
          sequence.push("bridge-disposed");
          dispose();
        };
      },
    );

    const dispose = center.registerProvider(provider);
    await center.createConnect({
      provider: "fake",
      name: "Ordering",
      config: {},
      agentPreset: "restricted",
    });

    const runtime = runtimes[0]!;
    runtime.stop.mockImplementation(async () => {
      sequence.push("runtime-stopped");
    });

    dispose();

    await vi.waitFor(() => {
      expect(sequence).toContain("bridge-disposed");
    });
    expect(sequence).toEqual(["runtime-stopped", "bridge-disposed"]);
  });

  it("createConnect rejects and persists nothing when provider.validate rejects", async () => {
    const { center, store, credentials } = await harness();
    const { provider, validate } = fakeProvider();
    validate.mockRejectedValueOnce(new Error("invalid_config"));
    center.registerProvider(provider);

    await expect(
      center.createConnect({
        provider: "fake",
        name: "Bad config",
        config: {},
        agentPreset: "restricted",
      }),
    ).rejects.toThrow("invalid_config");

    expect(await store.list()).toHaveLength(0);
    expect(credentials.store.size).toBe(0);
  });

  it("registerProvider starts already-enabled connects of that provider", async () => {
    const { center, messageCenter } = await harness();
    const { provider, starts, runtimes, start } = fakeProvider();
    const dispose = center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Reconcile",
      config: {},
      agentPreset: "restricted",
    });
    expect(start).toHaveBeenCalledTimes(1);

    // Dispose the provider registration: this stops the connect's runtime
    // (fire-and-forget behind the disposer) but the row itself stays
    // enabled in the store — nothing ever called setEnabled(false).
    dispose();
    await vi.waitFor(() => {
      expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
    });
    const strandedRow = (await center.listConnects()).find(
      (item) => item.id === view.id,
    );
    expect(strandedRow?.enabled).toBe(true);

    // Re-register the SAME provider id. registerProvider must reconcile:
    // the row is enabled but no longer live, so it should be started again
    // without any explicit setEnabled call.
    center.registerProvider(provider);

    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
    });

    const reconnected = (await center.listConnects()).find(
      (item) => item.id === view.id,
    );
    expect(reconnected?.status).not.toMatchObject({ state: "error" });

    // The runtime is actually live: a subsequent onInbound relays through
    // the bridge instead of being dropped.
    const handle = starts[starts.length - 1]!;
    await handle.onInbound({
      id: "after-reconcile",
      text: "hi",
      sender: "alice",
      conversation: { key: "c1", kind: "p2p" },
    });
    expect(
      messageCenter.acceptInboundCalls.some(
        (call) => (call.envelope as { id?: string }).id === "after-reconcile",
      ),
    ).toBe(true);
  });

  // Carryover from the mcp-namespacing work: registerProvider's
  // reconciliation (`startProviderConnects`) re-runs the FULL start path for
  // a stranded-but-enabled row, capability appliers included — a connect
  // that already registered an mcp server once, got disposed by a provider
  // reload, then comes back up under the provider's re-registration, must
  // re-apply (not skip) its "mcp" capability, landing a second
  // registerManagedServer call for the very same connect.
  it("registerProvider's reconciliation re-applies capabilities: a disposed-then-re-registered provider's connect gets a SECOND registerManagedServer call", async () => {
    const { center, mcp } = await harness();
    const { provider, runtimes } = fakeProvider();
    const dispose = center.registerProvider(provider);
    await center.createConnect({
      provider: "fake",
      name: "Carryover",
      config: {},
      agentPreset: "restricted",
    });

    expect(mcp.registerManagedServer).toHaveBeenCalledTimes(1);

    // Dispose the provider registration: this stops the connect's runtime
    // and disposes its "mcp" registration (fire-and-forget behind the
    // disposer), but the row itself stays enabled in the store — nothing
    // ever called setEnabled(false).
    dispose();
    await vi.waitFor(() => {
      expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
    });
    expect(mcp.disposers[0]).toHaveBeenCalledTimes(1);

    // Re-register the SAME provider id. registerProvider's reconciliation
    // finds the row enabled-but-not-live and starts it again, re-running
    // every capability decl from scratch.
    center.registerProvider(provider);

    await vi.waitFor(() => {
      expect(mcp.registerManagedServer).toHaveBeenCalledTimes(2);
    });
  });

  it("setEnabled(true) on an enabled-but-not-live row attempts a start", async () => {
    const { center } = await harness();
    const { provider, start, runtimes } = fakeProvider();
    center.registerProvider(provider);

    start.mockRejectedValueOnce(new Error("boom"));

    // createConnect swallows the startConnect error (`.catch(() =>
    // undefined)`), so the connect ends up created, enabled, but not live,
    // with an error status.
    const view = await center.createConnect({
      provider: "fake",
      name: "Retry after failure",
      config: {},
      agentPreset: "restricted",
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(view.status).toMatchObject({ state: "error" });
    const stranded = (await center.listConnects()).find(
      (item) => item.id === view.id,
    );
    expect(stranded?.enabled).toBe(true);

    // setEnabled(id, true) on an already-enabled row must not early-return
    // when that row isn't live — it must attempt a start.
    const after = await center.setEnabled(view.id, true);

    expect(start).toHaveBeenCalledTimes(2);
    expect(after.status).not.toMatchObject({ state: "error" });
    expect(runtimes).toHaveLength(1);
  });

  it("stop() joins a mid-start connect", async () => {
    const { center, messageCenter } = await harness();
    const { provider, start, starts } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Mid-start stop",
      config: {},
      agentPreset: "restricted",
    });
    await center.setEnabled(view.id, false);
    start.mockClear();

    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    } as unknown as ConnectorRuntime;
    const startGate = deferred<ConnectorRuntime>();
    start.mockImplementationOnce(async (handle: ConnectorHandle) => {
      starts.push(handle);
      return startGate.promise;
    });

    const enablePromise = center.setEnabled(view.id, true);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    // center.stop() must join the in-flight start (present in `starting`,
    // not yet `live`) rather than seeing an empty live set and no-op'ing.
    const stopPromise = center.stop();

    startGate.resolve(runtime);
    await Promise.all([enablePromise, stopPromise]);

    expect(runtime.stop).toHaveBeenCalledTimes(1);

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.deliver) throw new Error("bridge provider missing deliver");
    await expect(
      bridge.deliver({ id: "channel-1" } as never, {
        id: "o1",
        channelId: "channel-1",
        sessionId: "session-1",
        inReplyTo: "m1",
        text: "reply",
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("connector_not_live");
  });

  it("provider dispose joins that provider's mid-start connect", async () => {
    const { center, messageCenter, store } = await harness();
    const { provider, start, starts } = fakeProvider();
    const dispose = center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Mid-start dispose",
      config: {},
      agentPreset: "restricted",
    });
    await center.setEnabled(view.id, false);
    start.mockClear();

    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    } as unknown as ConnectorRuntime;
    const startGate = deferred<ConnectorRuntime>();
    start.mockImplementationOnce(async (handle: ConnectorHandle) => {
      starts.push(handle);
      return startGate.promise;
    });

    const enablePromise = center.setEnabled(view.id, true);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    // Freeze a row snapshot now (row.enabled is already true — setEnabled's
    // store.update ran before startConnect was called) and make the very
    // next store.list() call — the one dispose's teardown path issues —
    // resolve from it instead of hitting disk. Without this, that real
    // fs.readFile races against the pure-microtask start continuation
    // below: disk I/O can lose that race, letting the connect land in
    // `live` before teardown's read ever runs, which would make this
    // assertion pass against the unfixed center.ts too (a false green).
    const rows = await store.list();
    vi.spyOn(store, "list").mockImplementationOnce(async () => rows);

    // Dispose the provider registration while the re-enable's start is
    // still in-flight (present in `starting`, not yet `live` — `startGate`
    // hasn't been resolved yet).
    dispose();

    startGate.resolve(runtime);
    await enablePromise;

    await vi.waitFor(() => {
      expect(runtime.stop).toHaveBeenCalledTimes(1);
    });
    // The disposer only drops the messaging bridge once its connects (the
    // joined mid-start one included) have actually stopped.
    await vi.waitFor(() => {
      expect(messageCenter.providers.has("connector-fake")).toBe(false);
    });
  });

  it("re-registering a provider immediately after disposing it (no wait in between) does not throw the messaging bridge's duplicate-provider guard", async () => {
    const { center, messageCenter } = await harness();
    const { provider, start, runtimes } = fakeProvider();
    const dispose = center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Reload race",
      config: {},
      agentPreset: "restricted",
    });
    const firstRuntime = runtimes[0]!;
    start.mockClear();

    // Dispose the registration and IMMEDIATELY re-register the SAME
    // provider id — no `vi.waitFor` in between. `dispose()`'s teardown
    // (stopping this provider's connects, then dropping the messaging
    // bridge) is fire-and-forget behind the disposer, so the old bridge id
    // "connector-fake" is still occupied in messageCenter at the instant
    // registerProvider runs again. The real MessageChannelCenter throws
    // `duplicate channel provider ...` in that state (mirrored by this
    // test's fakeMessageCenter above) — registerProvider must not let that
    // exception escape.
    expect(() => {
      dispose();
      center.registerProvider(provider);
    }).not.toThrow();

    // The old runtime must actually stop (M1 ordering: connects before
    // bridge), and the connect must come back up under the new
    // registration — a fresh start(), not a leaked stale runtime.
    await vi.waitFor(() => {
      expect(firstRuntime.stop).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });

    const reconnected = (await center.listConnects()).find(
      (item) => item.id === view.id,
    );
    expect(reconnected?.status).not.toMatchObject({ state: "error" });

    // Exactly one bridge entry survives — the old one was dropped before
    // (or as part of) the new one landing, never both at once.
    await vi.waitFor(() => {
      expect(messageCenter.providers.size).toBe(1);
      expect(messageCenter.providers.has("connector-fake")).toBe(true);
    });
  });
});

describe("ConnectorCenter status lattice (off/degraded)", () => {
  it("reports off (not connecting) for a disabled connect", async () => {
    const { center } = await harness();
    const { provider } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Off test",
      config: {},
      agentPreset: "restricted",
    });
    expect(view.enabled).toBe(true);

    await center.setEnabled(view.id, false);
    const [disabled] = await center.listConnects();
    expect(disabled!.status).toEqual({ state: "off" });
  });

  it("reports connecting for an enabled row with no recorded status yet (e.g. before boot recovery has run)", async () => {
    const { center, store } = await harness();
    // A row created directly through the store, bypassing center's start
    // machinery entirely (no provider registered, no start() called) — the
    // statuses map has nothing recorded for it.
    const row = await store.create({
      provider: "fake",
      name: "No status yet",
      agentPreset: "restricted",
    });
    expect(row.enabled).toBe(true);

    const [view] = await center.listConnects();
    expect(view!.id).toBe(row.id);
    expect(view!.status).toEqual({ state: "connecting" });
  });

  it("a degraded status recorded by the mcp soft-skip survives a subsequent provider setStatus(ready)", async () => {
    const { center } = await harness({ withMcpManager: false });
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake",
      name: "Locked degraded",
      config: {},
      agentPreset: "restricted",
    });
    expect(view.status).toEqual({
      state: "degraded",
      detail: "mcp_manager_unavailable",
    });

    // A late-arriving provider write (e.g. the ws finally connecting) must
    // not silently clobber the applier-recorded degraded status.
    starts[0]!.setStatus({ state: "ready" });

    const [after] = await center.listConnects();
    expect(after!.status).toEqual({
      state: "degraded",
      detail: "mcp_manager_unavailable",
    });
  });

  it("a fresh enable clears the lock: once the capability becomes available, a subsequent provider ready lands", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-connector-center-"));
    roots.push(root);
    const store = new ConnectorStore(root);
    const messageCenter = fakeMessageCenter();
    const credentials = fakeCredentials();
    const mcp = fakeMcpManager();
    // A mutable availability flag (unlike `fakeAppliers`, which fixes
    // availability at harness construction) so the SAME applier instance
    // can miss on the first start and hit on the second — mirroring
    // index.ts's real "mcp" applier, which resolves availability at apply
    // time rather than at plugin-load time.
    let available = false;
    const appliers = new Map<
      string,
      { apply: (connect: StoredConnect, decl: CapabilityDecl) => Promise<() => void> }
    >();
    appliers.set("mcp", {
      apply: async (_connect, decl) => {
        if (decl.kind !== "mcp") throw new Error("unexpected_kind");
        if (!available) throw new CapabilityUnavailableError("mcp_manager_unavailable");
        return mcp.registerManagedServer(decl.spec);
      },
    });
    const ctx = { logger: () => ({ error: vi.fn() }) };
    const center = new ConnectorCenter(
      ctx as never,
      store,
      messageCenter as never,
      credentials as never,
      appliers,
    );

    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake",
      name: "Unlocked after re-enable",
      config: {},
      agentPreset: "restricted",
    });
    expect(view.status).toEqual({
      state: "degraded",
      detail: "mcp_manager_unavailable",
    });

    // The capability becomes available before the reconnect, so the second
    // start's applier call succeeds — no soft-skip, no re-lock.
    available = true;
    await center.setEnabled(view.id, false);
    await center.setEnabled(view.id, true);

    const freshHandle = starts[starts.length - 1]!;
    freshHandle.setStatus({ state: "ready" });

    const [after] = await center.listConnects();
    expect(after!.status).toEqual({ state: "ready" });
  });
});

describe("ConnectorCenter onboarding", () => {
  it("listProviders reports supportsOnboarding derived from the provider's onboard hook", async () => {
    const { center } = await harness();
    const { provider: plain } = fakeProvider(undefined, "plain");
    const { provider: onboardable } = fakeOnboardingProvider("onboardable");
    center.registerProvider(plain);
    center.registerProvider(onboardable);

    const views = center.listProviders();
    expect(views.find((view) => view.id === "plain")?.supportsOnboarding).toBe(
      false,
    );
    expect(
      views.find((view) => view.id === "onboardable")?.supportsOnboarding,
    ).toBe(true);
  });

  it("beginOnboarding starts pending, and an emitted qr update surfaces on the next poll", async () => {
    const { center } = await harness();
    const { provider, getHandle } = fakeOnboardingProvider();
    center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "Scan me",
      agentPreset: "restricted",
    });
    expect(view.state).toBe("pending");
    expect(view.sessionId).toMatch(/^onboard-/);

    const handle = getHandle();
    if (!handle) throw new Error("onboard handle not captured");
    handle.emit({ kind: "qr", url: "https://example.com/qr", expireIn: 120 });

    const polled = center.pollOnboarding(view.sessionId);
    expect(polled.state).toBe("pending");
    expect(polled.qrUrl).toBe("https://example.com/qr");
    expect(polled.qrExpireIn).toBe(120);
  });

  it("resolving onboard auto-creates and starts the connect, surfaced on the completed session", async () => {
    const { center } = await harness();
    const { provider, gate, start } = fakeOnboardingProvider();
    center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "Resolved",
      agentPreset: "restricted",
    });

    gate.resolve({ config: { token: "xyz" } });

    await vi.waitFor(() => {
      expect(center.pollOnboarding(view.sessionId).state).toBe("completed");
    });

    const polled = center.pollOnboarding(view.sessionId);
    expect(polled.connect).toBeDefined();
    expect(polled.connect?.provider).toBe("fake-onboard");
    expect(polled.connect?.name).toBe("Resolved");
    expect(start).toHaveBeenCalledTimes(1);

    const connects = await center.listConnects();
    expect(connects.some((connect) => connect.id === polled.connect?.id)).toBe(
      true,
    );
  });

  it("a rejected onboard settles the session as error with a bare (no 'Error: ' prefix) message", async () => {
    const { center } = await harness();
    const { provider, gate } = fakeOnboardingProvider();
    center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "Errored",
      agentPreset: "restricted",
    });

    gate.reject(new Error("boom"));

    await vi.waitFor(() => {
      expect(center.pollOnboarding(view.sessionId).state).toBe("error");
    });
    expect(center.pollOnboarding(view.sessionId).error).toBe("boom");
  });

  it("cancelOnboarding aborts the provider's signal, and the session settles as cancelled", async () => {
    const { center } = await harness();
    const { provider, gate, getHandle } = fakeOnboardingProvider();
    center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "Cancel me",
      agentPreset: "restricted",
    });

    const cancelledView = center.cancelOnboarding(view.sessionId);
    expect(cancelledView.sessionId).toBe(view.sessionId);

    const handle = getHandle();
    expect(handle?.signal.aborted).toBe(true);

    // A real onboard() is expected to observe the abort and reject; the fake
    // simulates that reaction explicitly rather than wiring an abort
    // listener into the fake itself.
    gate.reject(new Error("aborted"));

    await vi.waitFor(() => {
      expect(center.pollOnboarding(view.sessionId).state).toBe("cancelled");
    });
  });

  it("a stale onboard resolve arriving after cancel creates nothing: no connect, no start, session stays cancelled", async () => {
    const { center } = await harness();
    const { provider, gate, start } = fakeOnboardingProvider();
    center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "Cancel then resolve",
      agentPreset: "restricted",
    });

    center.cancelOnboarding(view.sessionId);

    // Unlike the "cancel then reject" test above, this provider ignores the
    // abort signal entirely and resolves anyway — the run chain must still
    // notice the session is no longer "pending" and refuse to create a
    // connect nobody asked for anymore.
    gate.resolve({ config: { token: "too-late" } });

    // Give the resolved promise's continuation — and, if the guard is
    // missing, createConnect's real disk I/O (store writes, credentials) —
    // a real turn of the event loop to run before asserting nothing
    // happened. A microtask-only flush (`await Promise.resolve()`) would
    // pass even against the unfixed code, since createConnect's fs writes
    // don't settle within pure microtasks.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(center.pollOnboarding(view.sessionId).state).toBe("cancelled");
    expect(start).not.toHaveBeenCalled();
    expect(await center.listConnects()).toEqual([]);
  });

  it("beginOnboarding throws onboarding_unsupported for a provider with no onboard hook", async () => {
    const { center } = await harness();
    const { provider } = fakeProvider(undefined, "no-onboard");
    center.registerProvider(provider);

    expect(() =>
      center.beginOnboarding({
        provider: "no-onboard",
        name: "x",
        agentPreset: "restricted",
      }),
    ).toThrow("onboarding_unsupported");
  });

  it("pollOnboarding and cancelOnboarding throw onboarding_not_found for an unknown session id", async () => {
    const { center } = await harness();

    expect(() => center.pollOnboarding("onboard-nope")).toThrow(
      "onboarding_not_found",
    );
    expect(() => center.cancelOnboarding("onboard-nope")).toThrow(
      "onboarding_not_found",
    );
  });

  it("lazily GCs a session more than 10 minutes old, dropping it on the next poll", async () => {
    let currentTime = Date.now();
    const { center } = await harness({ now: () => currentTime });
    const { provider } = fakeOnboardingProvider();
    center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "GC me",
      agentPreset: "restricted",
    });
    // Still fresh: not swept yet.
    expect(center.pollOnboarding(view.sessionId).sessionId).toBe(
      view.sessionId,
    );

    currentTime += 11 * 60 * 1000;

    expect(() => center.pollOnboarding(view.sessionId)).toThrow(
      "onboarding_not_found",
    );
  });

  it("the GC sweep aborts a dropped session's controller instead of orphaning it", async () => {
    let currentTime = Date.now();
    const { center } = await harness({ now: () => currentTime });
    const { provider, getHandle } = fakeOnboardingProvider();
    center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "GC abort me",
      agentPreset: "restricted",
    });

    const handle = getHandle();
    if (!handle) throw new Error("onboard handle not captured");
    expect(handle.signal.aborted).toBe(false);

    currentTime += 11 * 60 * 1000;
    // The poll itself sweeps (and, since this session is the one aged
    // past the ceiling, drops it) before discovering it's gone — but the
    // provider's in-flight onboard() must have already been told to stop
    // via its signal, not silently orphaned.
    expect(() => center.pollOnboarding(view.sessionId)).toThrow(
      "onboarding_not_found",
    );
    expect(handle.signal.aborted).toBe(true);
  });

  it("center.stop() cancels every in-flight onboarding session", async () => {
    const { center } = await harness();
    const { provider, getHandle } = fakeOnboardingProvider();
    center.registerProvider(provider);

    center.beginOnboarding({
      provider: "fake-onboard",
      name: "Stop me",
      agentPreset: "restricted",
    });

    await center.stop();

    const handle = getHandle();
    expect(handle?.signal.aborted).toBe(true);
  });
});
