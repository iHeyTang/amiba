import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  MessageChannelCenter,
  MessageCenterStore,
} from "@amiba/dsh-plugin-messaging-core";

import { ConnectorCenter } from "./center.js";
import { ConnectorStore, type StoredConnect } from "./store.js";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorProvider,
  ConnectorRuntime,
} from "./types.js";

// M1 acceptance proof: IM event -> adapter -> connector-core -> messaging-core
// -> session -> reply -> outbox -> adapter deliver, with zero platform code.
// Every collaborator here is the REAL mechanism-layer class (MessageChannelCenter,
// MessageCenterStore, ConnectorCenter, ConnectorStore) wired together exactly
// as plugins/dsh-plugin-connector-core/src/index.ts wires them; only the DSH
// agents runtime, the credentials seam, the mcp manager and the platform
// provider itself are faked, mirroring the harness techniques already proven
// in center.test.ts (fake appliers/credentials/mcp) and in messaging-core's
// own index.test.ts (fake agents ctx + reconcile event shapes).

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Copied from plugins/dsh-plugin-messaging-core/src/index.test.ts:17-71. */
function fakeAgentsCtx() {
  const followup = vi.fn();
  const listeners = new Map<string, (...args: never[]) => unknown>();
  const live = new Map<string, Record<string, unknown>>();
  const makeAgent = (id: string) => ({
    followup,
    session: { id, header: { id, agentPreset: "standard" }, events: [] },
    inbox: { nextTurn: [], nextStep: [] },
  });
  const resume = vi.fn(
    async ({ resumeSessionId }: { resumeSessionId: string }) => {
      // Not exercised by this e2e flow: every session here is freshly created
      // by conversation-scoped routing, never resumed from a cold store.
      throw new Error(`session_not_found:${resumeSessionId}`);
    },
  );
  const created: Array<{ sessionId: string; meta?: Record<string, unknown> }> =
    [];
  const dispose = vi.fn(async () => undefined);
  const create = vi.fn(
    async ({
      sessionId,
      meta,
    }: {
      sessionId: string;
      meta?: Record<string, unknown>;
    }) => {
      const agent = makeAgent(sessionId);
      live.set(sessionId, agent);
      created.push({ sessionId, ...(meta ? { meta } : {}) });
      return { agent, dispose };
    },
  );
  const ctx = {
    agents: { get: (id: string) => live.get(id), resume, create },
    agentPresets: { mount: vi.fn(async () => undefined) },
    sessionPersistence: {
      inspect: vi.fn(async () => {
        throw new Error("session_not_found");
      }),
    },
    on: (name: string, callback: (...args: never[]) => unknown) => {
      listeners.set(name, callback);
      return () => undefined;
    },
    effect: (callback: () => unknown) => {
      const cleanup = callback();
      return async () => {
        if (typeof cleanup === "function") await cleanup();
      };
    },
    logger: () => ({ error: vi.fn() }),
  };
  return { ctx, followup, listeners, live, created, dispose };
}

/** Same shape as center.test.ts's fakeCredentials(). */
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

/** Same shape as center.test.ts's fakeMcpManager(): async, resolves a disposer. */
function fakeMcpManager() {
  const disposers: Array<ReturnType<typeof vi.fn>> = [];
  const registerManagedServer = vi.fn(async (_spec: unknown) => {
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  return { registerManagedServer, disposers };
}

/**
 * Mirrors how plugins/dsh-plugin-connector-core/src/index.ts builds the real
 * appliers map: an "mcp" applier that resolves the manager at apply time and
 * forwards to its async registerManagedServer.
 */
function fakeAppliers(mcp: ReturnType<typeof fakeMcpManager>) {
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
      return mcp.registerManagedServer(decl.spec);
    },
  });
  return appliers;
}

/** A fake platform provider standing in for a real IM adapter (e.g. Lark). */
function fakeConnectorProvider() {
  const starts: ConnectorHandle[] = [];
  const runtimes: Array<{
    stop: ReturnType<typeof vi.fn>;
    deliver: ReturnType<typeof vi.fn>;
  }> = [];
  const validate = vi.fn(async () => undefined);
  const start = vi.fn(async (handle: ConnectorHandle) => {
    starts.push(handle);
    const runtime = {
      stop: vi.fn(async () => undefined),
      deliver: vi.fn(async () => undefined),
    };
    runtimes.push(runtime);
    return runtime as unknown as ConnectorRuntime;
  });
  const capabilities = vi.fn((): CapabilityDecl[] => [
    {
      kind: "mcp",
      service: { id: "test.mcp", name: "Test MCP", version: "1", shareable: true },
      identity: "fixture-account", tools: [{ name: "read", title: "Read" }],
      spec: {
        serverName: "e2e-fake",
        transport: "stdio",
        command: "echo",
        args: [],
        env: {},
        enabled: true,
      },
    },
  ]);
  const provider: ConnectorProvider = {
    messaging: { ownerPairing: true },
    id: "fakeim",
    name: "Fake IM",
    description: "Fake platform provider for the M1 e2e acceptance test",
    configSchema: {},
    validate,
    start,
    capabilities,
  };
  return { provider, starts, runtimes, validate, start };
}

function spyAcceptInbound(center: MessageChannelCenter) {
  return vi.spyOn(center, "acceptInbound");
}

describe("M1 acceptance: fake-provider end-to-end mechanism loop", () => {
  let agentsCtx: ReturnType<typeof fakeAgentsCtx>;
  let messageCenter: MessageChannelCenter;
  let connectorStore: ConnectorStore;
  let mcp: ReturnType<typeof fakeMcpManager>;
  let connectorCenter: ConnectorCenter;
  let providerFake: ReturnType<typeof fakeConnectorProvider>;
  let acceptInboundSpy!: ReturnType<typeof spyAcceptInbound>;

  let channelId!: string;
  let connectView!: Awaited<ReturnType<ConnectorCenter["createConnect"]>>;
  let handle!: ConnectorHandle;
  let runtime!: {
    stop: ReturnType<typeof vi.fn>;
    deliver: ReturnType<typeof vi.fn>;
  };
  let sessionId!: string;

  beforeAll(async () => {
    const messagingRoot = await mkdtemp(join(tmpdir(), "amiba-e2e-messaging-"));
    const connectorRoot = await mkdtemp(join(tmpdir(), "amiba-e2e-connector-"));
    roots.push(messagingRoot, connectorRoot);

    agentsCtx = fakeAgentsCtx();
    messageCenter = new MessageChannelCenter(
      agentsCtx.ctx as never,
      new MessageCenterStore(messagingRoot),
    );
    acceptInboundSpy = spyAcceptInbound(messageCenter);

    const credentials = fakeCredentials();
    mcp = fakeMcpManager();
    const appliers = fakeAppliers(mcp);

    connectorStore = new ConnectorStore(connectorRoot);
    connectorCenter = new ConnectorCenter(
      { logger: () => ({ error: vi.fn() }) } as never,
      connectorStore,
      messageCenter,
      credentials as never,
      appliers,
    );
  });

  it("stage 1: registers the fake provider and starts a connect with mcp capability", async () => {
    providerFake = fakeConnectorProvider();
    connectorCenter.registerProvider(providerFake.provider);

    connectView = await connectorCenter.createConnect({
      provider: "fakeim",
      name: "IM e2e",
      config: { token: "t" },
      agentPreset: "standard",
    });

    expect(providerFake.validate).toHaveBeenCalledWith({ token: "t" });
    expect(providerFake.start).toHaveBeenCalledTimes(1);
    channelId = (await connectorStore.list())[0]!.channelId!;
    expect(channelId).toBeTruthy();
    expect(connectView).not.toHaveProperty("channelId");
    expect(connectView.status).toEqual({ state: "connecting" });

    handle = providerFake.starts[0]!;
    runtime = providerFake.runtimes[0]!;

    // The mcp capability was applied through the fake manager: a real
    // registerManagedServer(spec) call resolving to a disposer.
    expect(mcp.registerManagedServer).toHaveBeenCalledTimes(1);
    expect(mcp.registerManagedServer).toHaveBeenCalledWith(
      expect.objectContaining({ serverName: "e2e-fake" }),
    );
    expect(mcp.disposers).toHaveLength(1);
  });

  it("stage 2: pairing inbound from alice creates a session and delivers followup", async () => {
    expect(acceptInboundSpy).toHaveBeenCalledTimes(0);

    await handle.onInbound({
      id: "m1",
      text: "hello agent",
      sender: "alice",
      conversation: { key: "chat-1", kind: "p2p" },
    });

    // Pairing admitted alice as the sole owner, atomically.
    expect(acceptInboundSpy).toHaveBeenCalledTimes(1);
    const row = (await connectorStore.list()).find(
      (item) => item.id === connectView.id,
    );
    expect(row?.pairing).toBe(false);
    expect(row?.owners).toEqual(["alice"]);

    // A brand-new session was created (conversation-scoped routing, no prior
    // binding for chat-1) carrying the connect's agentPreset.
    expect(agentsCtx.created).toHaveLength(1);
    expect(agentsCtx.created[0]!.meta).toMatchObject({
      agentPreset: "standard",
    });
    sessionId = agentsCtx.created[0]!.sessionId;

    // The session's fake Agent received followup() with the inbound text.
    expect(agentsCtx.followup).toHaveBeenCalledTimes(1);
    expect(agentsCtx.followup.mock.calls[0]?.[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "hello agent" }],
      source: { kind: "plugin", form: "relay" },
    });

    // The pending inbound row is durably observable via the messaging store.
    const pending = await messageCenter.store.listPending(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toBe("hello agent");
    expect(pending[0]?.channelId).toBe(channelId);
  });

  it("stage 3: firing the completed turn/end event reconciles the pending reply", async () => {
    const [pending] = await messageCenter.store.listPending(sessionId);
    expect(pending).toBeDefined();

    const events = [
      { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
      {
        seq: 1,
        time: 2,
        type: "user/message",
        data: {
          id: pending!.dshMessageId,
          role: "user",
          content: [{ type: "text", text: "hello agent" }],
          source: {
            kind: "plugin",
            plugin: `amiba-message:${channelId}`,
            form: "relay",
          },
        },
      },
      {
        seq: 2,
        time: 3,
        type: "assistant/message",
        data: {
          turn: 1,
          step: 1,
          message: {
            id: "a-1",
            role: "assistant",
            content: [{ type: "text", text: "done!" }],
            source: { kind: "model", provider: "test", model: "test" },
          },
        },
      },
      {
        seq: 3,
        time: 4,
        type: "turn/end",
        data: { turn: 1, reason: "completed" },
      },
    ];

    const agent = agentsCtx.live.get(sessionId) as {
      session: { events: unknown[] };
    };
    agent.session.events = events;
    agentsCtx.listeners.get("session/event")?.(
      agent.session as never,
      events[3] as never,
    );

    await vi.waitFor(async () => {
      expect(await messageCenter.store.listPending(sessionId)).toHaveLength(0);
    });
  });

  it("stage 4: the outbox pumps the reply into runtime.deliver with the conversation ref", async () => {
    await vi.waitFor(() => {
      expect(runtime.deliver).toHaveBeenCalledTimes(1);
    });

    // The reply text flowed all the way from the fake assistant/message event
    // to the platform adapter's deliver(), addressed at the original chat.
    expect(runtime.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ key: "chat-1", kind: "p2p" }),
      expect.objectContaining({
        text: "done!",
        sessionId,
        channelId: channelId,
      }),
    );
    expect(await messageCenter.store.listOutbox()).toHaveLength(0);
  });

  it("stage 5: an unpaired stranger's message is dropped before reaching messaging-core", async () => {
    const acceptCallsBefore = acceptInboundSpy.mock.calls.length;
    const createdBefore = agentsCtx.created.length;
    const deliverCallsBefore = runtime.deliver.mock.calls.length;

    await handle.onInbound({
      id: "m2",
      text: "i am a stranger",
      sender: "bob",
      conversation: { key: "chat-1", kind: "p2p" },
    });

    expect(acceptInboundSpy.mock.calls.length).toBe(acceptCallsBefore);
    expect(agentsCtx.created.length).toBe(createdBefore);
    expect(runtime.deliver.mock.calls.length).toBe(deliverCallsBefore);
    expect(await messageCenter.store.listPending()).toHaveLength(0);

    const row = (await connectorStore.list()).find(
      (item) => item.id === connectView.id,
    );
    expect(row?.owners).toEqual(["alice"]);
  });

  it("stage 6: disabling the connect tears down the runtime and the mcp disposer", async () => {
    const disposer = mcp.disposers[0]!;
    expect(disposer).toHaveBeenCalledTimes(0);
    expect(runtime.stop).toHaveBeenCalledTimes(0);

    const updated = await connectorCenter.setEnabled(connectView.id, false);

    expect(updated.enabled).toBe(false);
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(disposer).toHaveBeenCalledTimes(1);

    const row = (await connectorStore.list()).find(
      (item) => item.id === connectView.id,
    );
    expect(row?.enabled).toBe(false);
  });
});
