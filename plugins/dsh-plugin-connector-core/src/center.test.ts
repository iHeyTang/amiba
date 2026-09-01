import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MessageChannelProvider } from "@amiba/dsh-plugin-messaging-core";

import { ConnectorCenter } from "./center.js";
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
    async (input: { provider: string; name: string; agentPreset?: string }) => ({
      channel: { id: "channel-1", provider: input.provider, name: input.name },
      secret: "s3cret",
    }),
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

function fakeProvider(capabilities: CapabilityDecl[] = DEFAULT_CAPABILITIES) {
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
    id: "fake",
    name: "Fake Connector",
    description: "Fake connector for tests",
    configSchema: {},
    validate,
    start,
    capabilities: vi.fn(() => capabilities),
  };
  return { provider, starts, runtimes, validate, start };
}

async function harness(options?: { withMcpManager?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "amiba-connector-center-"));
  roots.push(root);
  const store = new ConnectorStore(root);
  const messageCenter = fakeMessageCenter();
  const credentials = fakeCredentials();
  const mcp = fakeMcpManager();
  const appliers = new Map<
    string,
    { apply: (connect: StoredConnect, decl: CapabilityDecl) => Promise<() => void> }
  >();
  if (options?.withMcpManager !== false) {
    appliers.set("mcp", {
      apply: async (_connect, decl) => {
        if (decl.kind !== "mcp") throw new Error("unexpected_kind");
        return mcp.registerManagedServer(decl.spec);
      },
    });
  }
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

    expect(messageCenter.providers.has("connector-fake")).toBe(false);
    expect(center.listProviders()).toEqual([]);
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

  it("pairing admits the first sender as owner and drops strangers silently", async () => {
    const { center, messageCenter, store } = await harness();
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Pairing",
      config: {},
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

  it("bridge deliver requires a live runtime and passes the conversation ref", async () => {
    const { center, messageCenter } = await harness();
    const { provider, runtimes } = fakeProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake",
      name: "Bridge",
      config: {},
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
    });

    expect(view.status).toMatchObject({
      state: "error",
      detail: "mcp_manager_unavailable",
    });
    expect(runtimes[0]!.stop).not.toHaveBeenCalled();
  });

  it("rolls back the channel, grant and row when provisioning fails before the runtime starts", async () => {
    const { center, credentials, messageCenter, store } = await harness();
    const { provider, starts } = fakeProvider();
    center.registerProvider(provider);

    credentials.modifyRecord.mockRejectedValueOnce(new Error("disk_full"));

    await expect(
      center.createConnect({ provider: "fake", name: "Doomed", config: {} }),
    ).rejects.toThrow("disk_full");

    // The channel was already created before the credential write failed, so
    // it must be torn down along with the (never-written) grant and row.
    expect(messageCenter.removeChannelCalls).toContain("channel-1");
    expect(credentials.store.size).toBe(0);
    expect(await store.list()).toHaveLength(0);
    // A provisioning failure never reaches the start fiber.
    expect(starts).toHaveLength(0);
  });

  it("createConnect rejects and persists nothing when provider.validate rejects", async () => {
    const { center, store, credentials } = await harness();
    const { provider, validate } = fakeProvider();
    validate.mockRejectedValueOnce(new Error("invalid_config"));
    center.registerProvider(provider);

    await expect(
      center.createConnect({ provider: "fake", name: "Bad config", config: {} }),
    ).rejects.toThrow("invalid_config");

    expect(await store.list()).toHaveLength(0);
    expect(credentials.store.size).toBe(0);
  });
});
