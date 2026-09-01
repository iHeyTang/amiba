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

async function harness(options?: { withMcpManager?: boolean }) {
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
    expect((view.status as { detail?: string }).detail).toContain(
      "unknown_capability_kind:cli",
    );
    expect(runtimes[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it("skips a capability when its manager dependency is unavailable, without aborting the connect", async () => {
    const { center } = await harness({ withMcpManager: false });
    const { provider, runtimes } = fakeProvider();
    center.registerProvider(provider);

    const view = await center.createConnect({
      provider: "fake",
      name: "No manager",
      config: {},
      agentPreset: "restricted",
    });

    expect(view.status).toMatchObject({
      state: "error",
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
    expect((view.status as { detail?: string }).detail).toContain(
      "duplicate managed MCP server",
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
});
