import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MessageChannelProvider } from "@amiba/dsh-plugin-messaging-core";

import { ConnectorCenter } from "./center.js";
import {
  AmibaConnectorsRemoteService,
  applyConnectorsRemote,
} from "./remote-service.js";
import { ConnectorStore, type StoredConnect } from "./store.js";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorProvider,
  ConnectorRuntime,
} from "./types.js";

// Harness copied from center.test.ts (per task-2-brief.md Step 2: "construct
// the center harness from center.test.ts (extract or copy the harness
// builder)"). Trimmed to what the remote-service tests actually exercise.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function fakeMessageCenter() {
  const providers = new Map<string, MessageChannelProvider>();
  const createChannel = vi.fn(
    async (input: {
      provider: string;
      name: string;
      agentPreset?: string;
      sessionId?: string;
    }) => {
      if (!input.agentPreset?.trim() && !input.sessionId?.trim())
        throw new Error("invalid_channel");
      return {
        channel: { id: "channel-1", provider: input.provider, name: input.name },
        secret: "s3cret",
      };
    },
  );
  const acceptInbound = vi.fn(
    async (channelId: string, secret: string, envelope: unknown) => ({
      accepted: true,
      duplicate: false,
      sessionId: "session-1",
    }),
  );
  const conversationForSession = vi.fn(
    async (channelId: string, sessionId: string) => ({
      conversationKey: "chat-1",
      kind: "p2p" as const,
      channelId,
      sessionId,
    }),
  );
  const removeChannel = vi.fn(async (_channelId: string) => true);
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
    conversationForSession,
    removeChannel,
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
  const start = vi.fn(async (handle: ConnectorHandle) => {
    starts.push(handle);
    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    } as unknown as ConnectorRuntime;
    return runtime;
  });
  const validate = vi.fn(async () => undefined);
  const provider: ConnectorProvider = {
    id,
    name: "Fake Connector",
    description: "Fake connector for tests",
    configSchema: {},
    validate,
    start,
    capabilities: vi.fn(() => capabilities),
  };
  return { provider, starts, validate, start };
}

function fakeAppliers(mcp: ReturnType<typeof fakeMcpManager>) {
  const appliers = new Map<
    string,
    { apply: (connect: StoredConnect, decl: CapabilityDecl) => Promise<() => void> }
  >();
  appliers.set("mcp", {
    apply: async (_connect, decl) => {
      if (decl.kind !== "mcp") throw new Error("unexpected_kind");
      return mcp.registerManagedServer(decl.spec);
    },
  });
  return appliers;
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "amiba-connector-remote-"));
  roots.push(root);
  const store = new ConnectorStore(root);
  const messageCenter = fakeMessageCenter();
  const credentials = fakeCredentials();
  const mcp = fakeMcpManager();
  const appliers = fakeAppliers(mcp);
  const ctx = { logger: () => ({ error: vi.fn() }) };
  const center = new ConnectorCenter(
    ctx as never,
    store,
    messageCenter as never,
    credentials as never,
    appliers,
  );
  return { root, store, messageCenter, credentials, mcp, center };
}

/**
 * Minimal fake Cordis Context sufficient for `TypertRemoteService`'s
 * constructor: `Service`'s base constructor only ever touches
 * `ctx.reflect.provide(name, self, check)` (see
 * node_modules/@deepseek-ai/cordis src/service.ts) — nothing else on `ctx` is
 * read during construction. Recording each call lets tests confirm
 * `applyConnectorsRemote` actually registered the service under its own
 * "amibaConnectorsRemote" Cordis service key (distinct from the
 * "amibaConnectors" key index.ts's `ConnectorCenter` occupies — see
 * remote-service.ts's constructor comment) and hand back the live instance
 * to drive directly.
 */
function fakeRemoteCtx() {
  const provided: Array<{ name: string; service: unknown }> = [];
  const ctx = {
    reflect: {
      provide: (name: string, service: unknown) => {
        provided.push({ name, service });
      },
    },
  };
  return { ctx, provided };
}

function buildService(center: ConnectorCenter) {
  const { ctx, provided } = fakeRemoteCtx();
  applyConnectorsRemote(ctx as never, center);
  const service = provided[0]?.service as AmibaConnectorsRemoteService;
  return { ctx, provided, service };
}

describe("AmibaConnectorsRemoteService", () => {
  it("registers itself under its own amibaConnectorsRemote service key, distinct from the amibaConnectors service center.ts provides", async () => {
    const { center } = await harness();
    const { provided, service } = buildService(center);

    expect(provided).toHaveLength(1);
    expect(provided[0]?.name).toBe("amibaConnectorsRemote");
    expect(service).toBeInstanceOf(AmibaConnectorsRemoteService);
    // The wire namespace (what the client and Gateway endpoint routing
    // actually key off) is unaffected by the service-key rename.
    expect(service.typertRemote).toMatchObject({
      serviceKey: "amibaConnectorsRemote",
      namespace: "amibaConnectors",
    });
  });

  it("listProviders reflects a registered fake provider", async () => {
    const { center } = await harness();
    const { provider } = fakeProvider();
    center.registerProvider(provider);
    const { service } = buildService(center);

    await expect(service.listProviders()).resolves.toEqual({
      providers: [
        {
          id: "fake",
          name: "Fake Connector",
          description: "Fake connector for tests",
          supportsOnboarding: false,
        },
      ],
    });
  });

  it("createConnect returns a ConnectView with no secret or config material", async () => {
    const { center } = await harness();
    const { provider } = fakeProvider();
    center.registerProvider(provider);
    const { service } = buildService(center);

    const view = await service.createConnect({
      provider: "fake",
      name: "Remote Connect",
      agentPreset: "restricted",
      config: { appSecret: "s3cret-app-value" },
    });

    // The fake provider's config value and the messaging channel secret
    // ("s3cret" from fakeMessageCenter.createChannel) must never appear in
    // what the Remote service hands back to the client.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("s3cret-app-value");
    expect(serialized).not.toContain("s3cret");
    expect(view).not.toHaveProperty("config");
    expect(Object.keys(view)).not.toContain("config");
    expect(view).toMatchObject({ provider: "fake", name: "Remote Connect" });
  });

  it("lets createConnect's agent_preset_required failure surface unmapped, exactly as messaging-core's service does", async () => {
    const { center } = await harness();
    const { provider } = fakeProvider();
    center.registerProvider(provider);
    const { service } = buildService(center);

    // AmibaMessagingRemoteService performs no try/catch translation of its
    // own — a thrown Error just propagates to the Gateway, which folds it
    // into the RemoteResult error channel. Driving the method directly (no
    // carrier in this test) means the same failure is observed as a plain
    // rejection here.
    await expect(
      service.createConnect({
        provider: "fake",
        name: "No preset",
        agentPreset: "   ",
        config: {},
      }),
    ).rejects.toThrow("agent_preset_required");
  });

  it("removeConnect on a missing id returns deleted: false", async () => {
    const { center } = await harness();
    const { service } = buildService(center);

    await expect(service.removeConnect("nope")).resolves.toEqual({
      id: "nope",
      deleted: false,
    });
  });

  it("setOwners round-trips the owners list", async () => {
    const { center } = await harness();
    const { provider } = fakeProvider();
    center.registerProvider(provider);
    const { service } = buildService(center);

    const created = await service.createConnect({
      provider: "fake",
      name: "Owners",
      agentPreset: "restricted",
      config: {},
    });

    const updated = await service.setOwners(created.id, ["alice", "bob"]);
    expect(updated.owners).toEqual(["alice", "bob"]);

    const listed = await service.listConnects();
    expect(
      listed.connects.find((connect) => connect.id === created.id)?.owners,
    ).toEqual(["alice", "bob"]);
  });

  it("setEnabled toggles the connect's enabled state", async () => {
    const { center } = await harness();
    const { provider } = fakeProvider();
    center.registerProvider(provider);
    const { service } = buildService(center);

    const created = await service.createConnect({
      provider: "fake",
      name: "Toggle",
      agentPreset: "restricted",
      config: {},
    });
    expect(created.enabled).toBe(true);

    const disabled = await service.setEnabled(created.id, false);
    expect(disabled.enabled).toBe(false);

    const enabled = await service.setEnabled(created.id, true);
    expect(enabled.enabled).toBe(true);
  });
});
