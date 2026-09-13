import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApprovalOutcomeNotice,
  ApprovalPrompt,
  MessageChannelProvider,
} from "@amiba/dsh-plugin-messaging-core";

import { CapabilityUnavailableError, ConnectorCenter, type CapabilityApplier } from "./center.js";
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
        channel: {
          id: "channel-1",
          provider: input.provider,
          name: input.name,
        },
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
  const updateChannel = vi.fn(
    async (channelId: string, patch: Record<string, unknown>) => ({
      id: channelId,
      ...patch,
    }),
  );
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
    updateChannel,
    registerProvider,
    listConversations: vi.fn(async () => []),
    listChannels: vi.fn(async () => []),
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
      service: { id: "test.mcp", name: "Test MCP", version: "1", shareable: true },
      identity: "fixture-account", tools: [{ name: "read", title: "Read" }],
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
    messaging: { ownerPairing: true },
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
 * A `fakeProvider` whose runtime optionally implements the approval
 * capability (`requestApproval` / `announceApprovalOutcome`), for exercising
 * `bridgeRequestApproval` / `bridgeAnnounceApprovalOutcome` in isolation.
 * `withApproval: false` mirrors a connector runtime that never implemented
 * the capability at all (e.g. a provider mid-migration, or one that will
 * never present natively).
 */
function fakeApprovalProvider(options?: {
  withApproval?: boolean;
  id?: string;
}) {
  const withApproval = options?.withApproval !== false;
  const starts: ConnectorHandle[] = [];
  const requestApproval = vi.fn(async () => ({
    outcome: "allowed-once" as const,
    by: "u1",
  }));
  const announceApprovalOutcome = vi.fn(async () => undefined);
  const runtimes: ConnectorRuntime[] = [];
  const validate = vi.fn(async () => undefined);
  const start = vi.fn(async (handle: ConnectorHandle) => {
    starts.push(handle);
    const runtime: ConnectorRuntime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
      ...(withApproval ? { requestApproval, announceApprovalOutcome } : {}),
    };
    runtimes.push(runtime);
    return runtime;
  });
  const provider: ConnectorProvider = {
    messaging: { ownerPairing: true },
    id: options?.id ?? "fake-approval",
    name: "Fake Approval Connector",
    description: "Fake connector for approval-bridge tests",
    configSchema: {},
    validate,
    start,
    capabilities: vi.fn(() => []),
  };
  return {
    provider,
    starts,
    runtimes,
    requestApproval,
    announceApprovalOutcome,
    start,
  };
}

function fakeApprovalPrompt(
  overrides?: Partial<ApprovalPrompt>,
): ApprovalPrompt {
  return {
    approvalId: "approval-1",
    seq: 1,
    toolName: "bash",
    sessionId: "session-1",
    signal: new AbortController().signal,
    // Stands in for messaging-core's own channel-level rule (an empty
    // `allowedSenders` admits everyone); the bridge's job is to narrow it
    // further with the connect's owners.
    canAnswer: async () => true,
    ...overrides,
  };
}

/** The prompt the bridge actually handed the runtime — the wrapped one. */
function wrappedPrompt(
  requestApproval: ReturnType<typeof vi.fn>,
): ApprovalPrompt {
  const call = requestApproval.mock.calls[0];
  if (!call) throw new Error("runtime.requestApproval was never called");
  return call[1] as ApprovalPrompt;
}

function fakeApprovalOutcomeNotice(
  overrides?: Partial<ApprovalOutcomeNotice>,
): ApprovalOutcomeNotice {
  return {
    approvalId: "approval-1",
    seq: 1,
    toolName: "bash",
    outcome: "allowed-once",
    reason: "answered",
    ...overrides,
  };
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
  const appliers = new Map<string, CapabilityApplier>();
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
  return {
    root,
    store,
    messageCenter,
    credentials,
    mcp,
    appliers,
    ctx,
    center,
  };
}

describe("fakeCredentials seam parity", () => {
  // The real seam (@deepseek-ai/dsh-credentials-local's modifyRecord)
  // declines the write and keeps the existing record when `mutate` resolves
  // to undefined — it does not delete. The test fake must match that so
  // tests exercising a declined mutate don't silently diverge from
  // production behavior.
  it("modifyRecord leaves an existing record untouched when mutate resolves to undefined", async () => {
    const { credentials } = await harness();
    const key = "amiba-connector-core/some-connect";
    await credentials.modifyRecord(key, async () => ({
      kind: "grant",
      payload: { config: {}, channelSecret: "s3cr3t" },
    }));

    const result = await credentials.modifyRecord(key, async () => undefined);

    expect(result).toMatchObject({
      kind: "grant",
      payload: { config: {}, channelSecret: "s3cr3t" },
    });
    expect(await credentials.readRecord(key)).toMatchObject({
      kind: "grant",
      payload: { config: {}, channelSecret: "s3cr3t" },
    });
  });

  it("modifyRecord on a never-written key stays absent when mutate resolves to undefined", async () => {
    const { credentials } = await harness();
    const key = "amiba-connector-core/never-written";

    const result = await credentials.modifyRecord(key, async () => undefined);

    expect(result).toBeUndefined();
    expect(await credentials.readRecord(key)).toBeUndefined();
  });
});

describe("provider-scoped private account access", () => {
  async function accountHarness() {
    const h = await harness();
    const off = h.center.registerProvider(fakeProvider([], "fake").provider);
    h.center.registerProvider(fakeProvider([], "other").provider);
    const a = await h.center.createConnect({ provider: "fake", name: "A", config: { token: "private-app" }, agentPreset: "default" });
    const b = await h.center.createConnect({ provider: "other", name: "B", config: {}, agentPreset: "default" });
    return { ...h, a, b, off, accounts: h.center.accounts("fake") };
  }
  it("enforces provider scope and excludes private state from public projections", async () => {
    const h = await accountHarness();
    await h.accounts.run(h.a.id, async (account) => account.updateState(() => ({ token: "personal-secret" })));
    expect((await h.accounts.list()).map((row) => row.id)).toEqual([h.a.id]);
    await expect(h.accounts.run(h.b.id, async () => "forbidden")).rejects.toThrow("connection_unavailable");
    expect(JSON.stringify(await h.center.getConnectDetails(h.a.id))).not.toContain("personal-secret");
    expect(JSON.stringify(await h.center.listConnects())).not.toContain("private-app");
    await h.accounts.run(h.a.id, async ({ config, state }) => { expect(config).toEqual({ token: "private-app" }); expect(state).toEqual({ token: "personal-secret" }); });
  });
  it("serializes private state updates without losing the app grant", async () => {
    const h = await accountHarness();
    await Promise.all([1, 2, 3].map(() => h.accounts.run(h.a.id, async (account) => account.updateState((current) => ({ n: ((current as { n: number } | undefined)?.n ?? 0) + 1 })))));
    await h.accounts.run(h.a.id, async ({ state, config }) => { expect(state).toEqual({ n: 3 }); expect(config).toEqual({ token: "private-app" }); });
  });
  it("disabling an account aborts requests and rejects stale results", async () => {
    const h = await accountHarness(), gate = deferred<string>(); let signal: AbortSignal | undefined;
    const result = h.accounts.run(h.a.id, async (account) => { signal = account.signal; return gate.promise; });
    await vi.waitFor(() => expect(signal).toBeDefined());
    await h.center.setEnabled(h.a.id, false); expect(signal?.aborted).toBe(true); gate.resolve("stale"); await expect(result).rejects.toThrow();
    await expect(h.accounts.run(h.a.id, async () => "no")).rejects.toThrow("connection_unavailable");
  });
  it("unloading a provider cancels resource operations", async () => {
    const h = await accountHarness(), gate = deferred<string>(); let signal: AbortSignal | undefined;
    const result = h.accounts.run(h.a.id, async (account) => { signal = account.signal; return gate.promise; });
    await vi.waitFor(() => expect(signal).toBeDefined()); h.off();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true)); gate.resolve("stale"); await expect(result).rejects.toThrow();
  });
});

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
        messaging: { ownerPairing: true },
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
    expect(view).not.toHaveProperty("channelId");
    expect((await store.list())[0]?.channelId).toBe("channel-1");
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
    expect(credentials.store.has(`amiba-connector-core/${view.id}`)).toBe(
      false,
    );
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
      {
        apply: (
          connect: StoredConnect,
          decl: CapabilityDecl,
        ) => Promise<() => void>;
      }
    >();
    appliers.set("mcp", {
      apply: async (_connect, decl) => {
        if (decl.kind !== "mcp") throw new Error("unexpected_kind");
        if (!available)
          throw new CapabilityUnavailableError("mcp_manager_unavailable");
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
    expect(cancelledView.state).toBe("cancelled");

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

  it("unregistering a provider aborts and settles its own in-flight onboarding sessions as cancelled", async () => {
    const { center } = await harness();
    const { provider, getHandle } = fakeOnboardingProvider();
    const dispose = center.registerProvider(provider);

    const view = center.beginOnboarding({
      provider: "fake-onboard",
      name: "Unregister me",
      agentPreset: "restricted",
    });

    const handle = getHandle();
    if (!handle) throw new Error("onboard handle not captured");
    expect(handle.signal.aborted).toBe(false);

    dispose();

    expect(handle.signal.aborted).toBe(true);
    expect(center.pollOnboarding(view.sessionId).state).toBe("cancelled");
  });

  it("unregistering a provider leaves another provider's in-flight onboarding session untouched", async () => {
    const { center } = await harness();
    const target = fakeOnboardingProvider("target-provider");
    const bystander = fakeOnboardingProvider("bystander-provider");
    const dispose = center.registerProvider(target.provider);
    center.registerProvider(bystander.provider);

    center.beginOnboarding({
      provider: "target-provider",
      name: "Unregister me",
      agentPreset: "restricted",
    });
    const bystanderView = center.beginOnboarding({
      provider: "bystander-provider",
      name: "Leave me alone",
      agentPreset: "restricted",
    });

    dispose();

    const bystanderHandle = bystander.getHandle();
    expect(bystanderHandle?.signal.aborted).toBe(false);
    expect(center.pollOnboarding(bystanderView.sessionId).state).toBe(
      "pending",
    );
  });
});

describe("approval bridge", () => {
  it("bridge requestApproval forwards to the live runtime and returns its reply", async () => {
    const { center, messageCenter } = await harness();
    const { provider, runtimes } = fakeApprovalProvider();
    center.registerProvider(provider);
    await center.createConnect({
      provider: "fake-approval",
      name: "Approval",
      config: {},
      agentPreset: "restricted",
    });

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.requestApproval)
      throw new Error("bridge provider missing requestApproval");
    const conversation = { key: "chat-1", kind: "p2p" as const };
    const request = fakeApprovalPrompt();

    const reply = await bridge.requestApproval(
      { id: "channel-1" } as never,
      conversation,
      request,
    );

    expect(reply).toEqual({ outcome: "allowed-once", by: "u1" });
    // Everything but `canAnswer` travels through untouched; `canAnswer` is
    // deliberately replaced with the owners-narrowed wrapper below.
    expect(runtimes[0]!.requestApproval).toHaveBeenCalledWith(conversation, {
      ...request,
      canAnswer: expect.any(Function),
    });
    expect(
      wrappedPrompt(runtimes[0]!.requestApproval as never).canAnswer,
    ).not.toBe(request.canAnswer);
  });

  it("bridge requestApproval resolves null when the runtime never implemented the capability", async () => {
    const { center, messageCenter } = await harness();
    const { provider, runtimes } = fakeApprovalProvider({
      withApproval: false,
    });
    center.registerProvider(provider);
    await center.createConnect({
      provider: "fake-approval",
      name: "No native approval",
      config: {},
      agentPreset: "restricted",
    });

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.requestApproval)
      throw new Error("bridge provider missing requestApproval");

    const reply = await bridge.requestApproval(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      fakeApprovalPrompt(),
    );

    expect(reply).toBeNull();
    expect(runtimes[0]!.requestApproval).toBeUndefined();
  });

  it("bridge requestApproval resolves null once the connect is disabled", async () => {
    const { center, messageCenter } = await harness();
    const { provider } = fakeApprovalProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake-approval",
      name: "Will be disabled",
      config: {},
      agentPreset: "restricted",
    });
    await center.setEnabled(view.id, false);

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.requestApproval)
      throw new Error("bridge provider missing requestApproval");

    const reply = await bridge.requestApproval(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      fakeApprovalPrompt(),
    );

    expect(reply).toBeNull();
  });

  it("bridge requestApproval throws connector_not_found when no connect owns the channel", async () => {
    const { center, messageCenter } = await harness();
    const { provider } = fakeApprovalProvider();
    center.registerProvider(provider);

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.requestApproval)
      throw new Error("bridge provider missing requestApproval");

    await expect(
      bridge.requestApproval(
        { id: "no-such-channel" } as never,
        { key: "chat-1", kind: "p2p" },
        fakeApprovalPrompt(),
      ),
    ).rejects.toThrow("connector_not_found");
  });

  it("bridge requestApproval propagates a runtime error rather than swallowing it", async () => {
    const { center, messageCenter } = await harness();
    const { provider, requestApproval } = fakeApprovalProvider();
    requestApproval.mockRejectedValueOnce(new Error("card_api_down"));
    center.registerProvider(provider);
    await center.createConnect({
      provider: "fake-approval",
      name: "Flaky card API",
      config: {},
      agentPreset: "restricted",
    });

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.requestApproval)
      throw new Error("bridge provider missing requestApproval");

    await expect(
      bridge.requestApproval(
        { id: "channel-1" } as never,
        { key: "chat-1", kind: "p2p" },
        fakeApprovalPrompt(),
      ),
    ).rejects.toThrow("card_api_down");
  });

  it("bridge announceApprovalOutcome forwards to the live runtime", async () => {
    const { center, messageCenter } = await harness();
    const { provider, runtimes } = fakeApprovalProvider();
    center.registerProvider(provider);
    await center.createConnect({
      provider: "fake-approval",
      name: "Announce",
      config: {},
      agentPreset: "restricted",
    });

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.announceApprovalOutcome)
      throw new Error("bridge provider missing announceApprovalOutcome");
    const conversation = { key: "chat-1", kind: "p2p" as const };
    const notice = fakeApprovalOutcomeNotice();

    await bridge.announceApprovalOutcome(
      { id: "channel-1" } as never,
      conversation,
      notice,
    );

    expect(runtimes[0]!.announceApprovalOutcome).toHaveBeenCalledWith(
      conversation,
      notice,
    );
  });

  it("bridge announceApprovalOutcome no-ops when the runtime lacks the capability", async () => {
    const { center, messageCenter } = await harness();
    const { provider } = fakeApprovalProvider({ withApproval: false });
    center.registerProvider(provider);
    await center.createConnect({
      provider: "fake-approval",
      name: "No native card",
      config: {},
      agentPreset: "restricted",
    });

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.announceApprovalOutcome)
      throw new Error("bridge provider missing announceApprovalOutcome");

    await expect(
      bridge.announceApprovalOutcome(
        { id: "channel-1" } as never,
        { key: "chat-1", kind: "p2p" },
        fakeApprovalOutcomeNotice(),
      ),
    ).resolves.toBeUndefined();
  });

  it("bridge announceApprovalOutcome no-ops once the connect is disabled", async () => {
    const { center, messageCenter } = await harness();
    const { provider, runtimes } = fakeApprovalProvider();
    center.registerProvider(provider);
    const view = await center.createConnect({
      provider: "fake-approval",
      name: "Will be disabled",
      config: {},
      agentPreset: "restricted",
    });
    await center.setEnabled(view.id, false);

    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.announceApprovalOutcome)
      throw new Error("bridge provider missing announceApprovalOutcome");

    await bridge.announceApprovalOutcome(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      fakeApprovalOutcomeNotice(),
    );

    expect(runtimes[0]!.announceApprovalOutcome).not.toHaveBeenCalled();
  });
});

describe("approval bridge sender gate", () => {
  async function liveConnect(options?: { owners?: string[] }) {
    const { center, messageCenter } = await harness();
    const { provider, runtimes, requestApproval } = fakeApprovalProvider();
    center.registerProvider(provider);
    const connect = await center.createConnect({
      provider: "fake-approval",
      name: "Approval",
      config: {},
      agentPreset: "restricted",
    });
    // `setOwners` is what clears `pairing` — the same call the operator's
    // own owners edit goes through.
    if (options?.owners) await center.setOwners(connect.id, options.owners);
    const bridge = messageCenter.registerProvider.mock.calls[0]?.[0];
    if (!bridge?.requestApproval)
      throw new Error("bridge provider missing requestApproval");
    return { center, bridge, connect, runtimes, requestApproval };
  }

  it("admits an owner and refuses everyone else", async () => {
    const { bridge, requestApproval } = await liveConnect({ owners: ["u1"] });

    await bridge.requestApproval!(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      fakeApprovalPrompt(),
    );

    const prompt = wrappedPrompt(requestApproval);
    await expect(prompt.canAnswer("u1")).resolves.toBe(true);
    await expect(prompt.canAnswer("u2")).resolves.toBe(false);
    await expect(prompt.canAnswer(undefined)).resolves.toBe(false);
  });

  it("refuses everyone while the connect is still pairing", async () => {
    const { bridge, requestApproval } = await liveConnect();

    await bridge.requestApproval!(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      fakeApprovalPrompt(),
    );

    // A fresh connect is `pairing: true` with no owners yet: nobody has been
    // admitted, so nobody may approve a tool call from its card either.
    await expect(wrappedPrompt(requestApproval).canAnswer("u1")).resolves.toBe(
      false,
    );
  });

  it("re-reads the connect row at click time, not when the card was sent", async () => {
    const { center, bridge, connect, requestApproval } = await liveConnect({
      owners: ["u1"],
    });

    await bridge.requestApproval!(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      fakeApprovalPrompt(),
    );
    const prompt = wrappedPrompt(requestApproval);
    await expect(prompt.canAnswer("u1")).resolves.toBe(true);

    await center.setOwners(connect.id, ["u2"]);
    await expect(prompt.canAnswer("u1")).resolves.toBe(false);
    await expect(prompt.canAnswer("u2")).resolves.toBe(true);
  });

  it("refuses once the connect is disabled or gone", async () => {
    const { center, bridge, connect, requestApproval } = await liveConnect({
      owners: ["u1"],
    });

    await bridge.requestApproval!(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      fakeApprovalPrompt(),
    );
    const prompt = wrappedPrompt(requestApproval);

    await center.setEnabled(connect.id, false);
    await expect(prompt.canAnswer("u1")).resolves.toBe(false);

    await center.removeConnect(connect.id);
    await expect(prompt.canAnswer("u1")).resolves.toBe(false);
  });

  it("never widens the channel's own rule: an owner the channel refuses is refused", async () => {
    const { bridge, requestApproval } = await liveConnect({ owners: ["u1"] });

    await bridge.requestApproval!(
      { id: "channel-1" } as never,
      { key: "chat-1", kind: "p2p" },
      // messaging-core's allowlist admits u2 only; u1 owns the connect.
      fakeApprovalPrompt({ canAnswer: async (sender) => sender === "u2" }),
    );

    const prompt = wrappedPrompt(requestApproval);
    await expect(prompt.canAnswer("u1")).resolves.toBe(false);
    await expect(prompt.canAnswer("u2")).resolves.toBe(false);
  });
});

describe("connection ownership and optional messaging", () => {
  it("runs a tool-only provider without creating a message bridge or channel", async () => {
    const { center, messageCenter, store, credentials } = await harness();
    const fake = fakeProvider([]);
    fake.start.mockResolvedValueOnce({ stop: vi.fn(async () => undefined) });
    center.registerProvider({ ...fake.provider, messaging: undefined });
    const connect = await center.createConnect({
      provider: "fake",
      name: "Tools",
      agentPreset: "restricted",
      config: { token: "private" },
    });
    expect(messageCenter.registerProvider).not.toHaveBeenCalled();
    expect(messageCenter.createChannel).not.toHaveBeenCalled();
    expect((await store.list())[0]).toMatchObject({ pairing: false });
    expect((await store.list())[0]).not.toHaveProperty("channelId");
    expect(credentials.store.get(`amiba-connector-core/${connect.id}`)).toEqual(
      { kind: "grant", payload: { config: { token: "private" } } },
    );
    expect(await center.getConnectDetails(connect.id)).toEqual({
      connect,
      settings: {},
    });
    await center.setEnabled(connect.id, false);
    await center.removeConnect(connect.id);
    expect(messageCenter.removeChannel).not.toHaveBeenCalled();
  });

  it("lets authenticated providers opt out of first-sender ownership without bypassing lifecycle gates", async () => {
    const { center, messageCenter } = await harness();
    const fake = fakeProvider([]);
    const dispose = center.registerProvider({
      ...fake.provider,
      messaging: { ownerPairing: false },
    });
    const connect = await center.createConnect({
      provider: "fake",
      name: "Custom",
      agentPreset: "restricted",
      config: {},
    });
    const handle = fake.starts[0]!;
    const envelope = {
      id: "1",
      text: "hello",
      conversation: { key: "thread", kind: "p2p" as const },
    };
    await expect(handle.onInbound(envelope)).resolves.toMatchObject({
      accepted: true,
    });
    expect(connect.pairing).toBe(false);
    await expect(center.setOwners(connect.id, ["alice"])).rejects.toThrow(
      "owner_pairing_unsupported",
    );
    dispose();
    await handle.onInbound({ ...envelope, id: "2" });
    expect(messageCenter.acceptInbound).toHaveBeenCalledTimes(1);
  });

  it("inherits approval policy and does not expose the internal channel id or a second policy mirror", async () => {
    const { center, messageCenter, store } = await harness();
    center.registerProvider(fakeProvider([]).provider);
    const connect = await center.createConnect({
      provider: "fake",
      name: "Bot",
      agentPreset: "restricted",
      config: {},
    });
    expect(connect).not.toHaveProperty("channelId");
    expect(connect).not.toHaveProperty("approval");
    expect((await store.list())[0]).not.toHaveProperty("approval");
    expect(messageCenter.createChannel).toHaveBeenCalledWith({
      provider: "connector-fake",
      name: "Bot",
      agentPreset: "restricted",
    });
  });

  it("pauses and resumes the bound delivery queue together with the connection", async () => {
    const { center, messageCenter } = await harness();
    center.registerProvider(fakeProvider([]).provider);
    const connect = await center.createConnect({
      provider: "fake",
      name: "Bot",
      agentPreset: "restricted",
      config: {},
    });
    await center.setEnabled(connect.id, false);
    expect(messageCenter.updateChannel).toHaveBeenLastCalledWith("channel-1", {
      enabled: false,
    });
    await center.setEnabled(connect.id, true);
    expect(messageCenter.updateChannel).toHaveBeenLastCalledWith("channel-1", {
      enabled: true,
    });
    messageCenter.updateChannel.mockRejectedValueOnce(new Error("disk_full"));
    await expect(center.setEnabled(connect.id, false)).rejects.toThrow(
      "disk_full",
    );
    expect((await center.listConnects())[0]?.enabled).toBe(true);
  });

  it("updates private configuration without synthesizing undefined credential fields", async () => {
    const { center, credentials } = await harness();
    const fake = fakeProvider([]);
    fake.provider.configure = (config, patch) => ({ ...(config as object), ...(patch as object) });
    center.registerProvider(fake.provider);
    const connect = await center.createConnect({ provider: "fake", name: "Work", agentPreset: "standard", config: { token: "before" } });
    const modify = credentials.modifyRecord.getMockImplementation()!;
    credentials.modifyRecord.mockImplementation(async (key, mutate) => modify(key, async current => {
      const next = await mutate(current);
      JSON.stringify(next, (_key, value) => {
        if (value === undefined) throw new Error("non_json_credential_value");
        return value;
      });
      return next;
    }));
    await expect(center.updateConnect(connect.id, { settings: { token: "after" } })).resolves.toMatchObject({ id: connect.id });
    expect(credentials.store.get(`amiba-connector-core/${connect.id}`)?.payload).toEqual({ config: { token: "after" }, channelSecret: "s3cret" });
    await center.stop();
  });

  it("shows capability usage while disabled and cleans approvals only when deleting the connection", async () => {
    const { center, appliers, store, credentials } = await harness();
    const removeConnect = vi.fn(async () => {});
    const describeConnect = vi.fn(async () => [{ name: "Knowledge", capabilities: ["Search documents"] }]);
    appliers.set("mcp", { apply: vi.fn(async () => () => {}), removeConnect, describeConnect });
    center.registerProvider(fakeProvider().provider);
    const connect = await center.createConnect({ provider: "fake", name: "Work", agentPreset: "standard", config: {} });
    await center.setEnabled(connect.id, false);
    expect(removeConnect).not.toHaveBeenCalled();
    expect(await center.getConnectDetails(connect.id)).toMatchObject({ capabilityUses: [{ name: "Knowledge", capabilities: ["Search documents"] }] });
    removeConnect.mockRejectedValueOnce(new Error("approval_store_unavailable"));
    await expect(center.removeConnect(connect.id)).rejects.toThrow("approval_store_unavailable");
    expect((await store.list()).map(row => row.id)).toContain(connect.id);
    expect(credentials.deleteRecord).not.toHaveBeenCalled();
    await expect(center.removeConnect(connect.id)).resolves.toBe(true);
    expect(removeConnect).toHaveBeenLastCalledWith(expect.objectContaining({ id: connect.id }));
    expect(await store.list()).toEqual([]);
    await center.stop();
  });

  it("renames and changes the default preset without restarting listeners or capability consumers", async () => {
    const { center, appliers, store } = await harness();
    const updateMetadata = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    appliers.set("mcp", { apply: vi.fn(async () => Object.assign(dispose, { updateMetadata })) });
    const fake = fakeProvider();
    center.registerProvider(fake.provider);
    const connect = await center.createConnect({ provider: "fake", name: "Before", agentPreset: "standard", config: {} });
    await center.updateConnect(connect.id, { name: "After", agentPreset: "code" });
    expect(fake.starts).toHaveLength(1);
    expect(fake.runtimes[0]!.stop).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(updateMetadata).toHaveBeenCalledWith(expect.objectContaining({ name: "After", agentPreset: "code" }));
    updateMetadata.mockRejectedValueOnce(new Error("rename_failed"));
    await expect(center.updateConnect(connect.id, { name: "Failed" })).rejects.toThrow("rename_failed");
    expect((await store.list())[0]?.name).toBe("After");
    expect(fake.starts).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();
    await center.stop();
  });

  it("projects only provider-selected settings and commits validated edits", async () => {
    const { center, messageCenter, credentials } = await harness();
    const fake = fakeProvider([]);
    fake.provider.settings = (config) => ({
      label: (config as { label: string }).label,
    });
    fake.provider.configure = (config, patch) => ({
      ...(config as object),
      ...patch,
    });
    center.registerProvider(fake.provider);
    const connect = await center.createConnect({
      provider: "fake",
      name: "Bot",
      agentPreset: "restricted",
      config: { label: "before", token: "private" },
    });
    const listChannels = vi.fn(async () => [
      {
        id: "channel-1",
        delivery: { pendingInbound: 1, queuedOutbound: 2, failedOutbound: 0 },
      },
    ]);
    Object.assign(messageCenter, { listChannels });
    const details = await center.getConnectDetails(connect.id);
    expect(details.settings).toEqual({ label: "before" });
    expect(JSON.stringify(details)).not.toContain("private");
    expect(details.messaging?.delivery.queuedOutbound).toBe(2);
    const updated = await center.updateConnect(connect.id, {
      name: "Renamed",
      agentPreset: "full",
      settings: { label: "after" },
    });
    expect(updated).toMatchObject({ name: "Renamed", agentPreset: "full" });
    expect(fake.validate).toHaveBeenLastCalledWith({
      label: "after",
      token: "private",
    });
    expect(fake.starts.at(-1)?.config).toEqual({
      label: "after",
      token: "private",
    });
    expect(credentials.store.size).toBe(1);
    expect(messageCenter.updateChannel).toHaveBeenLastCalledWith("channel-1", {
      name: "Renamed",
      agentPreset: "full",
    });
  });

  it("rejects invalid settings before stopping and rolls a failed restart back", async () => {
    const { center, store } = await harness();
    const fake = fakeProvider([]);
    fake.provider.configure = (config, patch) => ({
      ...(config as object),
      ...patch,
    });
    center.registerProvider(fake.provider);
    const connect = await center.createConnect({
      provider: "fake",
      name: "Bot",
      agentPreset: "restricted",
      config: { token: "old" },
    });
    fake.validate.mockRejectedValueOnce(new Error("invalid_config"));
    await expect(
      center.updateConnect(connect.id, { settings: { token: "bad" } }),
    ).rejects.toThrow("invalid_config");
    expect(fake.runtimes[0]!.stop).not.toHaveBeenCalled();
    fake.start.mockRejectedValueOnce(new Error("start_failed"));
    await expect(
      center.updateConnect(connect.id, {
        name: "Rejected",
        settings: { token: "new" },
      }),
    ).rejects.toThrow("start_failed");
    expect((await store.list())[0]?.name).toBe("Bot");
    expect(fake.starts.at(-1)?.config).toEqual({ token: "old" });
    expect((await center.listConnects())[0]?.status.state).not.toBe("error");
  });

  it("retires old inbound and status callbacks when an account restarts", async () => {
    const { center, messageCenter } = await harness();
    const fake = fakeProvider([]);
    fake.provider.configure = (_config, patch) => patch;
    center.registerProvider({ ...fake.provider, messaging: { ownerPairing: false } });
    const connect = await center.createConnect({ provider: "fake", name: "Bot", agentPreset: "restricted", config: {} });
    const oldHandle = fake.starts[0]!;
    await center.updateConnect(connect.id, { settings: { token: "new-credential" } });
    const envelope = { id: "late", text: "hello", conversation: { key: "thread", kind: "p2p" as const } };
    await oldHandle.onInbound(envelope);
    oldHandle.setStatus({ state: "error", detail: "stale" });
    expect(messageCenter.acceptInbound).not.toHaveBeenCalled();
    expect((await center.listConnects())[0]?.status.state).toBe("connecting");
    await fake.starts.at(-1)!.onInbound(envelope);
    expect(messageCenter.acceptInbound).toHaveBeenCalledOnce();
  });

  it("serializes edits with removal instead of resurrecting a removed account", async () => {
    const { center, store, credentials } = await harness();
    const fake = fakeProvider([]);
    fake.provider.configure = (config, patch) => ({
      ...(config as object),
      ...patch,
    });
    center.registerProvider(fake.provider);
    const connect = await center.createConnect({
      provider: "fake",
      name: "Bot",
      agentPreset: "restricted",
      config: {},
    });
    const gate = deferred<void>();
    fake.validate.mockImplementationOnce(() =>
      gate.promise.then(() => undefined),
    );
    const update = center.updateConnect(connect.id, {
      settings: { label: "new" },
    });
    const remove = center.removeConnect(connect.id);
    gate.resolve();
    await Promise.all([update, remove]);
    expect(await store.list()).toEqual([]);
    expect(credentials.store.size).toBe(0);
    expect(fake.runtimes.at(-1)!.stop).toHaveBeenCalledOnce();
  });
});

it("admits members to shared conversations while keeping pairing and approval authority with the owner", async () => {
  const { center, messageCenter, store } = await harness();
  const { provider, starts } = fakeProvider();
  center.registerProvider({ ...provider, messaging: { ownerPairing: true, sharedConversations: true } });
  const connect = await center.createConnect({ provider: "fake", name: "Group assistant", config: {}, agentPreset: "restricted" });
  const handle = starts[0]!;
  const group = { key: "group", kind: "group" as const };
  await handle.onInbound({ id: "first-group", text: "hi", sender: "member", conversation: group });
  expect(messageCenter.acceptInbound).not.toHaveBeenCalled();
  expect((await store.list())[0]?.owners).toEqual([]);
  await handle.onInbound({ id: "pair-owner", text: "hi", sender: "owner", conversation: { key: "owner-chat", kind: "p2p" } });
  await handle.onInbound({ id: "group-member", text: "help", sender: "member", conversation: group });
  expect(messageCenter.acceptInbound).toHaveBeenCalledTimes(2);
  const bridge = messageCenter.providers.get("connector-fake")!;
  const channel = { id: "channel-1" } as never;
  await expect(bridge.conversationAccess!(channel, { id: "g", text: "help", sender: "owner", conversation: group })).resolves.toBe("shared");
  await expect(bridge.conversationAccess!(channel, { id: "p", text: "help", sender: "owner", conversation: { key: "owner-chat", kind: "p2p" } })).resolves.toBe("owner");
  await expect(bridge.canApprove!(channel, "member")).resolves.toBe(false);
  await expect(bridge.canApprove!(channel, "owner")).resolves.toBe(true);
  await center.setOwners(connect.id, ["replacement"]);
  await expect(bridge.canApprove!(channel, "owner")).resolves.toBe(false);
});


describe("transient onboarding input", () => {
  it("exposes only the challenge and consumes its answer once", async () => {
    const { center } = await harness();
    const { provider, getHandle } = fakeOnboardingProvider();
    center.registerProvider(provider);
    const view = center.beginOnboarding({ provider: "fake-onboard", name: "Scan", agentPreset: "restricted" });
    const pending = getHandle()!.requestInput!("Verification code");
    const input = center.pollOnboarding(view.sessionId).input!;
    expect(input.label).toBe("Verification code");
    expect(() => center.submitOnboardingInput(view.sessionId, "wrong", "123456")).toThrow("unavailable");
    const result = center.submitOnboardingInput(view.sessionId, input.id, "123456");
    expect(await pending).toBe("123456");
    expect(result.input).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("123456");
    expect(() => center.submitOnboardingInput(view.sessionId, input.id, "123456")).toThrow("unavailable");
    center.cancelOnboarding(view.sessionId);
  });
  it("rejects pending input when the wizard closes or the provider aborts", async () => {
    const { center } = await harness();
    const { provider, getHandle } = fakeOnboardingProvider();
    center.registerProvider(provider);
    const view = center.beginOnboarding({ provider: "fake-onboard", name: "Scan", agentPreset: "restricted" });
    const pending = getHandle()!.requestInput!("Code");
    center.cancelOnboarding(view.sessionId);
    await expect(pending).rejects.toThrow("cancelled");
    expect(center.pollOnboarding(view.sessionId).input).toBeUndefined();
  });
});

it('removes a connection when the wizard is cancelled during provisioning', async () => {
  const { center } = await harness();
  const { provider, gate } = fakeOnboardingProvider();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const validate = vi.fn(() => blocked);
  center.registerProvider({ ...provider, validate });
  const view = center.beginOnboarding({ provider: 'fake-onboard', name: 'Scan', agentPreset: 'restricted' });
  const remove = vi.spyOn(center, 'removeConnect');
  gate.resolve({ config: {} });
  await vi.waitFor(() => expect(validate).toHaveBeenCalled());
  center.cancelOnboarding(view.sessionId); release();
  await vi.waitFor(() => expect(remove).toHaveBeenCalled());
  await vi.waitFor(async () => expect(await center.listConnects()).toEqual([]));
  expect(center.pollOnboarding(view.sessionId).state).toBe('cancelled');
});
