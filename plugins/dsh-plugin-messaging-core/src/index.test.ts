import { ConversationLifecycle } from "@amiba/dsh-plugin-session-features";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageChannelCenter, type MessageChannelProvider } from "./center.js";
import { MessageCenterStore } from "./store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "amiba-message-center-"));
  roots.push(root);
  const followup = vi.fn();
  const listeners = new Map<string, (...args: never[]) => unknown>();
  const live = new Map<string, Record<string, unknown>>();
  const makeAgent = (id: string) => ({
    followup,
    session: { id, header: { id, agentPreset: "standard", createdAt: new Date(2026, 8, 12, 14, 30).getTime() }, events: [] },
    inbox: { nextTurn: [], nextStep: [] },
  });
  live.set("session-a", makeAgent("session-a"));
  const resumed: Array<{
    resumeSessionId: string;
    agentOptions?: Record<string, unknown>;
  }> = [];
  const resume = vi.fn(
    async ({
      resumeSessionId,
      setup,
      agentOptions,
    }: {
      resumeSessionId: string;
      setup?: (agentCtx: unknown) => Promise<unknown>;
      agentOptions?: Record<string, unknown>;
    }) => {
      if (resumeSessionId !== "session-cold")
        throw new Error("session_not_found");
      if (setup) await setup({});
      const agent = makeAgent(resumeSessionId);
      live.set(resumeSessionId, agent);
      resumed.push({
        resumeSessionId,
        ...(agentOptions ? { agentOptions } : {}),
      });
      return { agent };
    },
  );
  const created: Array<{
    sessionId: string;
    meta?: Record<string, unknown>;
    agentOptions?: Record<string, unknown>;
  }> = [];
  const dispose = vi.fn(async () => undefined);
  const create = vi.fn(
    async ({
      sessionId,
      meta,
      setup,
      agentOptions,
    }: {
      sessionId: string;
      meta?: Record<string, unknown>;
      setup?: (agentCtx: unknown) => Promise<unknown>;
      agentOptions?: Record<string, unknown>;
    }) => {
      if (setup) await setup({});
      const agent = makeAgent(sessionId);
      live.set(sessionId, agent);
      created.push({
        sessionId,
        ...(meta ? { meta } : {}),
        ...(agentOptions ? { agentOptions } : {}),
      });
      return { agent, dispose };
    },
  );
  const loggerCalls = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const defaultModelService = {
    currentSelection: () => ({ provider: "deepseek", model: "deepseek-chat" }),
  };
  // The DSH-wide archived-session set (`ctx.workspaceRegistry`, mirrors
  // `@deepseek-ai/dsh-workspace`). A plain mutable array so tests can push an
  // id into it in place and have `isSessionArchived` see the change on its
  // next read — same reflect.get lookup as `agentDefaultModel` below.
  const archivedSessionIds: string[] = [];
  // Mirrors the real Cordis contract: messaging-core never declares
  // `agentDefaultModel` (or `workspaceRegistry`) in `inject`, so both must be
  // read via `ctx.reflect.get` (a point-in-time lookup that returns
  // undefined for an absent service) rather than as a direct property —
  // Cordis throws on a bare, un-injected property ACCESS. `reflectServices`
  // lets `harnessWithoutDefaultModel`/`harnessWithoutWorkspaceRegistry`
  // simulate the headless case by removing just one entry.
  const reflectServices = new Map<string, unknown>([
    ["agentDefaultModel", defaultModelService],
    ["workspaceRegistry", { archivedSessionIds }],
  ]);
  const ctx = {
    agents: { get: (id: string) => live.get(id), resume, create },
    agentPresets: { mount: vi.fn(async () => undefined) },
    reflect: { get: (name: string) => reflectServices.get(name) },
    sessionPersistence: {
      inspect: vi.fn(async (id: string) => {
        if (id !== "session-cold") throw new Error("session_not_found");
        return { meta: { id, agentPreset: "standard" }, events: [] };
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
    logger: () => loggerCalls,
  };
  const center = new MessageChannelCenter(
    ctx as never,
    new MessageCenterStore(root),
  );
  center.registerProvider({
    id: "webhook",
    name: "Webhook",
    description: "Test transport",
    supportsInbound: true,
    supportsOutbound: true,
  });
  return {
    center,
    followup,
    listeners,
    resume,
    resumed,
    live,
    created,
    create,
    dispose,
    ctx,
    reflectServices,
    archivedSessionIds,
    loggerCalls,
  };
}

/** A harness variant with no `agentDefaultModel` mounted, mirroring headless
 * runtimes where that Cordis service is never published — `ctx.reflect.get`
 * returns undefined for it, same as an un-injected service on real Cordis. */
async function harnessWithoutDefaultModel() {
  const built = await harness();
  built.reflectServices.delete("agentDefaultModel");
  return built;
}

/** A harness variant with no `workspaceRegistry` mounted, mirroring a bundle
 * assembled without the DSH base row (or this plugin's own narrower tests) —
 * `ctx.reflect.get` returns undefined for it, so nothing is ever archived. */
async function harnessWithoutWorkspaceRegistry() {
  const built = await harness();
  built.reflectServices.delete("workspaceRegistry");
  return built;
}

describe("DSH-native message channel center", () => {
  it("stores only a secret digest and exposes a safe channel view", async () => {
    const { center } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Deploy events",
      sessionId: "session-a",
    });
    expect(created.secret).toMatch(/^amiba_/u);
    expect(created.channel).not.toHaveProperty("secretHash");
    expect(JSON.stringify(await center.store.list())).not.toContain(
      created.secret,
    );
  });

  it("authenticates, deduplicates, authorizes senders and routes to one live Agent", async () => {
    const { center, followup } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Alerts",
      sessionId: "session-a",
      allowedSenders: ["github"],
    });
    await expect(
      center.acceptInbound(created.channel.id, "wrong", {
        id: "evt-1",
        text: "deploy failed",
        sender: "github",
      }),
    ).rejects.toThrow("unauthorized");
    await expect(
      center.acceptInbound(created.channel.id, created.secret, {
        id: "evt-1",
        text: "deploy failed",
        sender: "unknown",
      }),
    ).rejects.toThrow("sender_not_allowed");
    expect(
      await center.acceptInbound(created.channel.id, created.secret, {
        id: "evt-1",
        text: "deploy failed",
        sender: "github",
      }),
    ).toMatchObject({
      accepted: true,
      duplicate: false,
      sessionId: "session-a",
    });
    expect(
      await center.acceptInbound(created.channel.id, created.secret, {
        id: "evt-1",
        text: "deploy failed",
        sender: "github",
      }),
    ).toMatchObject({ accepted: true, duplicate: true });
    expect(followup).toHaveBeenCalledTimes(1);
    expect(followup.mock.calls[0]?.[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "deploy failed" }],
      source: { kind: "plugin", form: "relay" },
    });
  });

  it("correlates a completed DSH turn and drains the durable reply outbox", async () => {
    const { center, listeners, live } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Reply",
      sessionId: "session-a",
    });
    await center.acceptInbound(created.channel.id, created.secret, {
      id: "evt-reply",
      text: "status?",
    });
    const [pending] = await center.store.listPending("session-a");
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
          content: [{ type: "text", text: "status?" }],
          source: {
            kind: "plugin",
            plugin: `amiba-message:${created.channel.id}`,
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
            id: "reply-1",
            role: "assistant",
            content: [{ type: "text", text: "All green." }],
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
    const agent = live.get("session-a") as { session: { events: unknown[] } };
    agent.session.events = events;
    listeners.get("session/event")?.(
      agent.session as never,
      events[3] as never,
    );
    await vi.waitFor(async () => {
      expect(await center.store.listPending("session-a")).toHaveLength(0);
      expect(await center.store.listOutbox()).toHaveLength(0);
    });
  });

  it("surfaces a readable reason instead of [object Object] when a turn ends in error", async () => {
    const { center, listeners, live } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Reply",
      sessionId: "session-a",
    });
    await center.acceptInbound(created.channel.id, created.secret, {
      id: "evt-error",
      text: "status?",
    });
    const [pending] = await center.store.listPending("session-a");
    expect(pending).toBeDefined();
    const queueReply = vi.spyOn(center.store, "queueReply");
    const events = [
      { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
      {
        seq: 1,
        time: 2,
        type: "user/message",
        data: {
          id: pending!.dshMessageId,
          role: "user",
          content: [{ type: "text", text: "status?" }],
          source: {
            kind: "plugin",
            plugin: `amiba-message:${created.channel.id}`,
            form: "relay",
          },
        },
      },
      {
        seq: 2,
        time: 3,
        type: "turn/end",
        data: {
          turn: 1,
          reason: {
            kind: "error",
            error: {
              message:
                'prompt variable "{{model}}" has no value for this assembly (section "deployment:persona")',
              code: "UNKNOWN",
            },
          },
        },
      },
    ];
    const agent = live.get("session-a") as { session: { events: unknown[] } };
    agent.session.events = events;
    listeners.get("session/event")?.(agent.session as never, events[2] as never);
    await vi.waitFor(() => {
      expect(queueReply).toHaveBeenCalled();
    });
    const [, envelope] = queueReply.mock.calls[0]!;
    expect(envelope.text).not.toContain("[object Object]");
    expect(envelope.text).toContain(
      'prompt variable "{{model}}" has no value',
    );
    queueReply.mockRestore();
  });

  it("resumes a persisted cold session before accepting its message", async () => {
    const { center, followup, resume } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Cold",
      sessionId: "session-cold",
    });
    await expect(
      center.acceptInbound(created.channel.id, created.secret, {
        id: "evt-cold",
        text: "wake up",
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(followup).toHaveBeenCalledTimes(1);
    expect(await center.store.listPending("session-cold")).toHaveLength(1);
  });

  it("does not consume an idempotency key when its persisted session is missing", async () => {
    const { center } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Cold",
      sessionId: "missing",
    });
    await expect(
      center.acceptInbound(created.channel.id, created.secret, {
        id: "evt-retry",
        text: "retry me",
      }),
    ).rejects.toThrow("session_not_found");
    expect(
      await center.store.acceptReceipt(`${created.channel.id}:evt-retry`),
    ).toBe(true);
  });
});

describe("conversation-scoped routing", () => {
  it("creates and binds a session on first contact, reuses it after", async () => {
    const { center, followup, created } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    const first = await center.acceptInbound(channel.id, secret, {
      id: "msg-1",
      text: "hello",
      sender: "alice",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.meta).toMatchObject({ agentPreset: "restricted" });
    expect(first.sessionId).toBe(created[0]!.sessionId);

    const second = await center.acceptInbound(channel.id, secret, {
      id: "msg-2",
      text: "again",
      sender: "alice",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(created).toHaveLength(1); // no new session
    expect(second.sessionId).toBe(first.sessionId);
    expect(followup).toHaveBeenCalledTimes(2);

    const other = await center.acceptInbound(channel.id, secret, {
      id: "msg-3",
      text: "different chat",
      sender: "alice",
      conversation: { key: "chat-2", kind: "group", title: "Team" },
    });
    expect(created).toHaveLength(2);
    expect(other.sessionId).not.toBe(first.sessionId);

    expect(await center.listConversations(channel.id)).toHaveLength(2);
    expect(
      await center.conversationForSession(channel.id, first.sessionId),
    ).toMatchObject({ conversationKey: "chat-1" });
  });

  it("unbinding a conversation makes the next message start a fresh session", async () => {
    const { center, created } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    const first = await center.acceptInbound(channel.id, secret, {
      id: "m-1",
      text: "hi",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(await center.unbindConversation(channel.id, "chat-1")).toBe(true);
    const second = await center.acceptInbound(channel.id, secret, {
      id: "m-2",
      text: "hi again",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(created).toHaveLength(2);
  });

  it("keeps the single-session fallback and rejects fallback-less channels", async () => {
    const { center } = await harness();
    const fallback = await center.createChannel({
      provider: "webhook",
      name: "Legacy",
      sessionId: "session-a",
    });
    const routed = await center.acceptInbound(
      fallback.channel.id,
      fallback.secret,
      { id: "evt-1", text: "no conversation field" },
    );
    expect(routed.sessionId).toBe("session-a");

    const conversationOnly = await center.createChannel({
      provider: "webhook",
      name: "Connector-style",
      agentPreset: "restricted",
    });
    await expect(
      center.acceptInbound(conversationOnly.channel.id, conversationOnly.secret, {
        id: "evt-2",
        text: "missing conversation",
      }),
    ).rejects.toThrow("conversation_required");

    await expect(
      center.createChannel({ provider: "webhook", name: "Neither" }),
    ).rejects.toThrow("invalid_channel");
  });

  it("serializes concurrent first messages of one conversation into one session", async () => {
    const { center, created } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    const [a, b] = await Promise.all([
      center.acceptInbound(channel.id, secret, {
        id: "r-1",
        text: "race one",
        conversation: { key: "chat-r", kind: "p2p" },
      }),
      center.acceptInbound(channel.id, secret, {
        id: "r-2",
        text: "race two",
        conversation: { key: "chat-r", kind: "p2p" },
      }),
    ]);
    expect(created).toHaveLength(1);
    expect(a.sessionId).toBe(b.sessionId);
  });

  it("disposes the freshly created agent when binding the conversation fails, then retries cleanly", async () => {
    const { center, created, dispose } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    const bindConversation = vi
      .spyOn(center.store, "bindConversation")
      .mockRejectedValueOnce(new Error("disk_full"));

    await expect(
      center.acceptInbound(channel.id, secret, {
        id: "b-1",
        text: "first attempt",
        conversation: { key: "chat-b", kind: "p2p" },
      }),
    ).rejects.toThrow("disk_full");
    expect(dispose).toHaveBeenCalledTimes(1);

    const second = await center.acceptInbound(channel.id, secret, {
      id: "b-2",
      text: "second attempt",
      conversation: { key: "chat-b", kind: "p2p" },
    });
    expect(created).toHaveLength(2);
    expect(second.sessionId).not.toBe(created[0]!.sessionId);
    expect(second.sessionId).toBe(created[1]!.sessionId);
    expect(await center.listConversations(channel.id)).toHaveLength(1);

    bindConversation.mockRestore();
  });

  it("rejects creation instead of publishing a presetless session", async () => {
    const { center, followup, created, ctx, loggerCalls } = await harness();
    ctx.agentPresets.mount.mockRejectedValueOnce(
      new Error('agent-presets: unknown preset "restricted"'),
    );
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });

    await expect(
      center.acceptInbound(channel.id, secret, {
        id: "msg-1",
        text: "hello",
        sender: "alice",
        conversation: { key: "chat-1", kind: "p2p" },
      }),
    ).rejects.toThrow(/unknown preset/);

    expect(created).toHaveLength(0);
    expect(followup).not.toHaveBeenCalled();
    expect(await center.listConversations(channel.id)).toHaveLength(0);
  });

  it("rejects resume instead of running without the chosen preset", async () => {
    const { center, followup, resume, ctx, loggerCalls } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Cold",
      sessionId: "session-cold",
    });
    ctx.agentPresets.mount.mockRejectedValueOnce(
      new Error('agent-presets: unknown preset "standard"'),
    );

    await expect(
      center.acceptInbound(channel.id, secret, {
        id: "evt-cold",
        text: "wake up",
      }),
    ).rejects.toThrow(/unknown preset/);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(followup).not.toHaveBeenCalled();
  });
});

describe("archived = closed: a bound session that got archived starts fresh", () => {
  it("starts a new session and rebinds the conversation when the bound session is archived", async () => {
    const { center, created, archivedSessionIds, loggerCalls } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    const first = await center.acceptInbound(channel.id, secret, {
      id: "msg-1",
      text: "hello",
      sender: "alice",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(created).toHaveLength(1);

    archivedSessionIds.push(first.sessionId);

    const second = await center.acceptInbound(channel.id, secret, {
      id: "msg-2",
      text: "still here?",
      sender: "alice",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(created).toHaveLength(2);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second).toMatchObject({ accepted: true, duplicate: false });

    // The rebind is durable: the conversation binding now points at the new
    // session, not the archived one.
    expect(
      await center.conversationForSession(channel.id, second.sessionId),
    ).toMatchObject({ conversationKey: "chat-1" });
    expect(
      await center.conversationForSession(channel.id, first.sessionId),
    ).toMatchObject({ conversationKey: "chat-1", superseded: true });

    // The new session got the same recipe as first-time binding.
    expect(created[1]!.meta).toMatchObject({ agentPreset: "restricted" });

    expect(loggerCalls.info).toHaveBeenCalledTimes(1);
    const [info] = loggerCalls.info.mock.calls[0]!;
    expect(String(info)).toContain(first.sessionId);
  });

  it("resumes the bound session unchanged when it is not archived", async () => {
    const { center, created, resumed } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Cold",
      sessionId: "session-cold",
    });
    await center.acceptInbound(channel.id, secret, {
      id: "evt-1",
      text: "wake up",
    });
    await center.acceptInbound(channel.id, secret, {
      id: "evt-2",
      text: "still there",
    });
    expect(resumed).toHaveLength(1);
    expect(created).toHaveLength(0);
    const channels = await center.listChannels();
    expect(channels[0]!.sessionId).toBe("session-cold");
  });

  it("leaves everything unchanged when workspaceRegistry is not mounted", async () => {
    const { center, created } = await harnessWithoutWorkspaceRegistry();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    const first = await center.acceptInbound(channel.id, secret, {
      id: "msg-1",
      text: "hello",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    const second = await center.acceptInbound(channel.id, secret, {
      id: "msg-2",
      text: "again",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(created).toHaveLength(1);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("rebinds a channel's fixed single-session binding when it is archived", async () => {
    const { center, created, archivedSessionIds } = await harness();
    const fallback = await center.createChannel({
      provider: "webhook",
      name: "Legacy",
      sessionId: "session-a",
      agentPreset: "restricted",
    });
    archivedSessionIds.push("session-a");

    const routed = await center.acceptInbound(
      fallback.channel.id,
      fallback.secret,
      { id: "evt-1", text: "no conversation field" },
    );
    expect(routed.sessionId).not.toBe("session-a");
    expect(created).toHaveLength(1);
    const channels = await center.listChannels();
    expect(channels[0]!.sessionId).toBe(routed.sessionId);
  });

  it("serializes concurrent inbounds on an archived fixed-session channel into one fresh session", async () => {
    const { center, created, archivedSessionIds } = await harness();
    const fallback = await center.createChannel({
      provider: "webhook",
      name: "Legacy",
      sessionId: "session-a",
      agentPreset: "restricted",
    });
    archivedSessionIds.push("session-a");

    const [a, b] = await Promise.all([
      center.acceptInbound(fallback.channel.id, fallback.secret, {
        id: "evt-1",
        text: "race one",
      }),
      center.acceptInbound(fallback.channel.id, fallback.secret, {
        id: "evt-2",
        text: "race two",
      }),
    ]);
    // Exactly one fresh session must be created, and both inbounds bind to
    // it — the same single-flight guarantee `resolveConversationSession`
    // already has via `conversationCreates`, applied to the fixed-session
    // (`channel.sessionId`) path.
    expect(created).toHaveLength(1);
    expect(a.sessionId).toBe(b.sessionId);
    const channels = await center.listChannels();
    expect(channels[0]!.sessionId).toBe(a.sessionId);
  });
});

describe("default model injection for IM sessions", () => {
  it("supplies the deployment default model when creating a session for a new conversation", async () => {
    const { center, created } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    await center.acceptInbound(channel.id, secret, {
      id: "msg-1",
      text: "hello",
      sender: "alice",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.agentOptions).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("supplies the deployment default model when resuming a cold session", async () => {
    const { center, resumed } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Cold",
      sessionId: "session-cold",
    });
    await center.acceptInbound(channel.id, secret, {
      id: "evt-cold",
      text: "wake up",
    });
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.agentOptions).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("omits agentOptions without throwing when agentDefaultModel is not mounted (headless runtimes)", async () => {
    const { center, created, resumed } = await harnessWithoutDefaultModel();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    await expect(
      center.acceptInbound(channel.id, secret, {
        id: "msg-1",
        text: "hello",
        conversation: { key: "chat-1", kind: "p2p" },
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(created).toHaveLength(1);
    expect(created[0]!.agentOptions).toBeUndefined();

    const cold = await center.createChannel({
      provider: "webhook",
      name: "Cold",
      sessionId: "session-cold",
    });
    await expect(
      center.acceptInbound(cold.channel.id, cold.secret, {
        id: "evt-cold",
        text: "wake up",
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(resumed).toHaveLength(1);
    expect(resumed[0]!.agentOptions).toBeUndefined();
  });

  it("reads the default model through ctx.reflect.get, not a direct ctx.agentDefaultModel property", async () => {
    // Regression guard for the runtime bug: Cordis throws on the bare
    // property ACCESS of an undeclared injected service — before optional
    // chaining ever runs — so `ctx.agentDefaultModel?.currentSelection?.()`
    // is unsafe even though it reads like a safe optional access. A getter
    // that throws on access (mimicking Cordis's inject guard) proves the
    // production code path never touches `ctx.agentDefaultModel` directly;
    // it must go through `ctx.reflect.get("agentDefaultModel")` instead.
    const { center, created, ctx } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    Object.defineProperty(ctx, "agentDefaultModel", {
      configurable: true,
      get(): never {
        throw new Error(
          'cannot get property "agentDefaultModel" without inject',
        );
      },
    });

    await expect(
      center.acceptInbound(channel.id, secret, {
        id: "msg-1",
        text: "hello",
        conversation: { key: "chat-1", kind: "p2p" },
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(created).toHaveLength(1);
    expect(created[0]!.agentOptions).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });
});

describe("IM session cwd", () => {
  it("gives a freshly created conversation session an absolute cwd so {{cwd}} prompt assembly succeeds", async () => {
    const { center, created } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    await center.acceptInbound(channel.id, secret, {
      id: "msg-1",
      text: "hello",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    expect(created).toHaveLength(1);
    const meta = created[0]!.meta as { cwd?: string; agentPreset?: string };
    expect(typeof meta.cwd).toBe("string");
    expect(meta.cwd).toBe(process.cwd());
    expect(meta.cwd!.startsWith("/")).toBe(true);
    // The agent preset must still be carried alongside the new cwd field.
    expect(meta.agentPreset).toBe("restricted");
  });

  it("still succeeds without a cwd on the resume path (cwd comes from the persisted session header)", async () => {
    const { center, resume } = await harness();
    const { channel, secret } = await center.createChannel({
      provider: "webhook",
      name: "Cold",
      sessionId: "session-cold",
    });
    await expect(
      center.acceptInbound(channel.id, secret, {
        id: "evt-cold",
        text: "wake up",
      }),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(resume).toHaveBeenCalledTimes(1);
    // Resume never receives a `meta` field (its own harness stub above has
    // no meta parameter at all) — cwd for a resumed session already lives on
    // its persisted session header, not something this call can inject.
    const [call] = resume.mock.calls[0]!;
    expect((call as Record<string, unknown>).meta).toBeUndefined();
  });
});

describe("outbound delivery retry", () => {
  it("manually retries only failed replies in this channel and never revives approvals or archived history", async () => {
    const { center, reflectServices } = await harness();
    const deliver = vi.fn<NonNullable<MessageChannelProvider["deliver"]>>(async () => {});
    center.registerProvider({ id: "manual-retry", name: "Retry", description: "", supportsInbound: true, supportsOutbound: true, deliver });
    const { channel } = await center.store.create({ provider: "manual-retry", name: "One", sessionId: "session-a" });
    const { channel: other } = await center.store.create({ provider: "manual-retry", name: "Two", sessionId: "session-a" });
    await seedDelivery(center, channel.id, "reply");
    await seedDelivery(center, other.id, "other-reply");
    await center.store.queueOutbound({ id: "old-approval", channelId: channel.id, sessionId: "session-a", inReplyTo: "approval:old", text: "Approve", createdAt: new Date().toISOString() });
    await center.store.queueOutbound({ id: "archived", channelId: channel.id, sessionId: "archived-session", inReplyTo: "old-message", text: "Old reply", createdAt: new Date().toISOString() });
    reflectServices.set("workspaceRegistry", { archivedSessionIds: ["archived-session"] });
    for (const id of ["reply", "other-reply", "old-approval", "archived"]) await center.store.markDeliveryFailed(id, "offline");
    expect(await center.retryFailedReplies(channel.id)).toEqual({ retried: 1 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[1]).toMatchObject({ id: "reply", channelId: channel.id });
    expect((await center.store.listOutbox()).map(item => item.id).sort()).toEqual(["archived", "old-approval", "other-reply"]);
    expect(await center.retryFailedReplies(channel.id)).toEqual({ retried: 0 });
  });

  it("serializes concurrent manual retries and keeps a renewed failure visible", async () => {
    const { center } = await harness();
    const deliver = vi.fn<NonNullable<MessageChannelProvider["deliver"]>>(async () => { throw new Error("still offline"); });
    center.registerProvider({ id: "retry-offline", name: "Retry", description: "", supportsInbound: true, supportsOutbound: true, deliver });
    const { channel } = await center.store.create({ provider: "retry-offline", name: "One", sessionId: "session-a" });
    await seedDelivery(center, channel.id, "reply");
    await center.store.markDeliveryFailed("reply", "offline");
    await center.retryFailedReplies(channel.id);
    expect((await center.store.listOutbox())[0]).toMatchObject({ attempts: 1, lastError: "Error: still offline" });
    deliver.mockResolvedValue(undefined);
    await Promise.all([center.retryFailedReplies(channel.id), center.retryFailedReplies(channel.id)]);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(await center.store.listOutbox()).toEqual([]);
  });
  // Mirrors the DELIVERY_MAX_ATTEMPTS constant in center.ts.
  const DELIVERY_MAX_ATTEMPTS = 8;

  async function seedDelivery(
    center: Awaited<ReturnType<typeof harness>>["center"],
    channelId: string,
    deliveryId: string,
  ) {
    await center.store.acceptInbound({
      key: `pending-${deliveryId}`,
      channelId,
      messageId: `msg-${deliveryId}`,
      sessionId: "session-a",
      dshMessageId: `dsh-${deliveryId}`,
      text: "hi",
      acceptedAt: new Date().toISOString(),
    });
    await center.store.queueReply(`pending-${deliveryId}`, {
      id: deliveryId,
      channelId,
      sessionId: "session-a",
      inReplyTo: `msg-${deliveryId}`,
      text: "reply",
      createdAt: new Date().toISOString(),
    });
  }

  it("retries with backoff instead of dropping the delivery when the channel provider is unregistered", async () => {
    const { center, loggerCalls } = await harness();
    const { channel } = await center.store.create({
      provider: "ghost-provider",
      name: "Ghost channel",
      sessionId: "session-a",
    });
    await seedDelivery(center, channel.id, "delivery-1");

    await center.start();

    const outbox = await center.store.listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.attempts).toBe(1);
    expect(outbox[0]?.lastError).toBe("provider_unregistered");
    expect(outbox[0]?.nextAttemptAt).toBeTruthy();
    expect(loggerCalls.error).toHaveBeenCalled();
    const [message] = loggerCalls.error.mock.calls.at(-1)!;
    expect(String(message)).toContain("delivery-1");
    expect(String(message)).toContain("provider_unregistered");
  });

  it("delivers on the next pump once the provider is re-registered", async () => {
    const { center } = await harness();
    const { channel } = await center.store.create({
      provider: "ghost-provider",
      name: "Ghost channel",
      sessionId: "session-a",
    });
    await seedDelivery(center, channel.id, "delivery-2");

    await center.start();
    expect((await center.store.listOutbox())[0]?.attempts).toBe(1);

    // Simulate the backoff window having elapsed so the delivery is due again.
    await center.store.markDeliveryFailed(
      "delivery-2",
      "provider_unregistered",
      new Date(0).toISOString(),
    );

    const deliver = vi.fn(async () => undefined);
    center.registerProvider({
      id: "ghost-provider",
      name: "Ghost",
      description: "Recovered transport",
      supportsInbound: false,
      supportsOutbound: true,
      deliver,
    });

    await vi.waitFor(async () => {
      expect(await center.store.listOutbox()).toHaveLength(0);
    });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("stops retrying and leaves the delivery terminal after DELIVERY_MAX_ATTEMPTS", async () => {
    const { center } = await harness();
    const { channel } = await center.store.create({
      provider: "ghost-provider",
      name: "Ghost channel",
      sessionId: "session-a",
    });
    await seedDelivery(center, channel.id, "delivery-3");
    for (let i = 0; i < DELIVERY_MAX_ATTEMPTS - 1; i += 1) {
      await center.store.markDeliveryFailed(
        "delivery-3",
        "provider_unregistered",
        new Date(0).toISOString(),
      );
    }

    await center.start();

    const outbox = await center.store.listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.attempts).toBe(DELIVERY_MAX_ATTEMPTS);
    expect(outbox[0]?.nextAttemptAt).toBeUndefined();
    expect(outbox[0]?.lastError).toBe("provider_unregistered");
  });

  it("drops a reply whose session was archived between the turn/end event and delivery, instead of delivering it to the rebound conversation", async () => {
    const { center, archivedSessionIds, loggerCalls } = await harness();
    const deliver = vi.fn(async () => undefined);
    center.registerProvider({
      id: "webhook-with-deliver",
      name: "Webhook",
      description: "Test transport",
      supportsInbound: true,
      supportsOutbound: true,
      deliver,
    });
    const { channel } = await center.store.create({
      provider: "webhook-with-deliver",
      name: "Reply channel",
      sessionId: "session-a",
    });
    // Mirrors `reconcileSession`'s `queueReply`: the reply was produced while
    // session-a was still current — this is the durable outbox entry, seeded
    // directly rather than via a real turn/end event.
    await seedDelivery(center, channel.id, "delivery-archived");

    // The session is archived after the reply was queued but before delivery
    // runs — e.g. a concurrent inbound rebound the conversation to a fresh
    // session in the meantime.
    archivedSessionIds.push("session-a");

    await center.start();

    expect(deliver).not.toHaveBeenCalled();
    // Settled terminal — same shape as the DELIVERY_MAX_ATTEMPTS case above
    // (entry stays for diagnostics, `nextAttemptAt` cleared so it is never
    // attempted again) rather than a new "archived" outbox status.
    const outbox = await center.store.listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.nextAttemptAt).toBeUndefined();
    expect(outbox[0]?.lastError).toBe("session_archived");
    expect(loggerCalls.warn).toHaveBeenCalled();
    const [warning] = loggerCalls.warn.mock.calls.at(-1)!;
    expect(String(warning)).toContain("delivery-archived");
  });
});

describe("channel approval policy", () => {
  it("reads back the default policy for channels stored before the field existed", async () => {
    const { center } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Legacy channel",
      sessionId: "session-a",
    });
    expect(created.channel.approval).toEqual({
      mode: "timeout",
      timeoutMs: 600_000,
    });
    // The default is applied on read, never written into the stored row.
    expect((await center.store.list())[0]?.approval).toBeUndefined();
  });

  it("persists an explicit policy through create and update", async () => {
    const { center } = await harness();
    const created = await center.createChannel({
      provider: "webhook",
      name: "Ops",
      sessionId: "session-a",
      approval: { mode: "wait", timeoutMs: 600_000 },
    });
    expect(created.channel.approval).toEqual({
      mode: "wait",
      timeoutMs: 600_000,
    });
    const updated = await center.updateChannel(created.channel.id, {
      approval: { mode: "timeout", timeoutMs: 900_000 },
    });
    expect(updated.approval).toEqual({ mode: "timeout", timeoutMs: 900_000 });
    expect((await center.store.list())[0]?.approval).toEqual({
      mode: "timeout",
      timeoutMs: 900_000,
    });
  });

  it("refuses a policy that no human could answer", async () => {
    const { center } = await harness();
    await expect(
      center.createChannel({
        provider: "webhook",
        name: "Ops",
        sessionId: "session-a",
        approval: { mode: "asap", timeoutMs: 600_000 } as never,
      }),
    ).rejects.toThrow("invalid_channel_approval");
    await expect(
      center.createChannel({
        provider: "webhook",
        name: "Ops",
        sessionId: "session-a",
        approval: { mode: "timeout", timeoutMs: 5_000 },
      }),
    ).rejects.toThrow("invalid_channel_approval");
    await expect(
      center.createChannel({
        provider: "webhook",
        name: "Ops",
        sessionId: "session-a",
        approval: { mode: "timeout", timeoutMs: 1.5 } as never,
      }),
    ).rejects.toThrow("invalid_channel_approval");
    expect(await center.store.list()).toHaveLength(0);

    const created = await center.createChannel({
      provider: "webhook",
      name: "Ops",
      sessionId: "session-a",
      approval: { mode: "wait", timeoutMs: 600_000 },
    });
    await expect(
      center.updateChannel(created.channel.id, {
        approval: { mode: "timeout", timeoutMs: 1_000 },
      }),
    ).rejects.toThrow("invalid_channel_approval");
    expect((await center.store.list())[0]?.approval).toEqual({
      mode: "wait",
      timeoutMs: 600_000,
    });
  });

  it("rolls a rejected update back to having no policy of its own", async () => {
    const { center } = await harness();
    let reject = false;
    center.registerProvider({
      id: "picky",
      name: "Picky",
      description: "Refuses the update",
      supportsInbound: true,
      supportsOutbound: true,
      validate: () => {
        if (reject) throw new Error("provider_says_no");
      },
    });
    const created = await center.createChannel({
      provider: "picky",
      name: "Ops",
      sessionId: "session-a",
    });
    expect((await center.store.list())[0]?.approval).toBeUndefined();

    reject = true;
    await expect(
      center.updateChannel(created.channel.id, {
        approval: { mode: "wait", timeoutMs: 600_000 },
      }),
    ).rejects.toThrow("provider_says_no");
    // The row carried no policy of its own before the rejected patch, so the
    // rollback has to CLEAR the field again — leaving the rejected value in
    // place would silently apply a policy the provider refused.
    expect((await center.store.list())[0]?.approval).toBeUndefined();
    expect((await center.listChannels())[0]?.approval).toEqual({
      mode: "timeout",
      timeoutMs: 600_000,
    });
  });
});


it("manages only registered chat entries and applies settings on the next message", async () => {
  const { center, reflectServices, created } = await harness();
  const root = await mkdtemp(join(tmpdir(), "amiba-message-settings-"));
  roots.push(root);
  reflectServices.set("amibaConversations", new ConversationLifecycle(root));
  const { channel, secret } = await center.createChannel({ provider: "webhook", name: "Settings", agentPreset: "standard" });
  const conversation = { key: "group-a", kind: "group" as const };
  await expect(center.conversationSettings(channel.id, conversation.key, { action: "status" })).rejects.toThrow("conversation_not_found");
  expect(created).toHaveLength(0);
  const first = await center.acceptInbound(channel.id, secret, { id: "first", text: "hello", conversation });
  const status = await center.conversationSettings(channel.id, conversation.key, { action: "status" });
  expect(status.currentSessionId).toBe(first.sessionId);
  await center.conversationSettings(channel.id, conversation.key, { action: "configure", cadence: "manual" });
  const pending = await center.conversationSettings(channel.id, conversation.key, { action: "new" });
  expect(pending.pendingNewConversation).toBe(true);
  expect(created).toHaveLength(1);
  await expect(center.conversationSettings("another-account", conversation.key, { action: "new" })).rejects.toThrow("conversation_not_found");
  const second = await center.acceptInbound(channel.id, secret, { id: "second", text: "again", conversation });
  expect(second.sessionId).not.toBe(first.sessionId);
  const after = await center.conversationSettings(channel.id, conversation.key, { action: "status" });
  expect(after.history).toHaveLength(2);
  expect(after.pendingNewConversation).toBe(false);
  expect(after.policy).toEqual({ ...status.policy, cadence: "manual" });
});

it("uses the shared lifecycle for day changes while retaining previous reply routes", async () => {
  const { center, reflectServices, created, dispose } = await harness();
  const root = await mkdtemp(join(tmpdir(), "amiba-message-lifecycle-"));
  roots.push(root);
  let now = Date.now();
  const lifecycle = new ConversationLifecycle(root, () => now);
  reflectServices.set("amibaConversations", lifecycle);
  const { channel, secret } = await center.createChannel({ provider: "webhook", name: "Daily", agentPreset: "standard" });
  const conversation = { key: "group-a", kind: "group" as const };
  const first = await center.acceptInbound(channel.id, secret, { id: "day-1", text: "hello", conversation });
  now += 48 * 60 * 60 * 1000;
  const duplicate = await center.acceptInbound(channel.id, secret, { id: "day-1", text: "hello", conversation });
  expect(duplicate).toMatchObject({ duplicate: true, sessionId: first.sessionId });
  expect(created).toHaveLength(1);
  const second = await center.acceptInbound(channel.id, secret, { id: "day-2", text: "hello again", conversation });
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(created).toHaveLength(2);
  expect(await center.conversationForSession(channel.id, first.sessionId)).toMatchObject({ conversationKey: "group-a" });
  expect(await center.conversationForSession(channel.id, second.sessionId)).toMatchObject({ conversationKey: "group-a" });
  expect(await center.listConversations(channel.id)).toHaveLength(1);
  expect(await lifecycle.history({ plugin: "webhook", entry: channel.id, scope: "group-a" })).toHaveLength(2);
  expect(dispose).not.toHaveBeenCalled();
});

it("migrates old routes at startup without choosing a superseded session as current", async () => {
  const { center, reflectServices } = await harness();
  const root = await mkdtemp(join(tmpdir(), "amiba-route-migration-"));
  roots.push(root);
  const lifecycle = new ConversationLifecycle(root);
  reflectServices.set("amibaConversations", lifecycle);
  const { channel } = await center.createChannel({ provider: "webhook", name: "Legacy", agentPreset: "standard" });
  await center.store.bindConversation({ channelId: channel.id, conversationKey: "legacy-chat", kind: "p2p", sessionId: "previous" });
  await center.store.bindConversation({ channelId: channel.id, conversationKey: "legacy-chat", kind: "p2p", sessionId: "current" });
  await center.start();
  const origin = { plugin: "webhook", entry: channel.id, scope: "legacy-chat" };
  expect((await lifecycle.history(origin)).map((segment) => segment.sessionId).sort()).toEqual(["current", "previous"]);
  const create = vi.fn();
  const resolved = await lifecycle.resolve(origin, { create, isClosed: () => false }, undefined, false);
  expect(resolved.sessionId).toBe("current");
  expect(create).not.toHaveBeenCalled();
});

it("starts a fresh restricted segment when a legacy owner conversation becomes shared", async () => {
  const { center, reflectServices, create } = await harness();
  const root = await mkdtemp(join(tmpdir(), "amiba-shared-entry-"));
  roots.push(root);
  const lifecycle = new ConversationLifecycle(root);
  reflectServices.set("amibaConversations", lifecycle);
  let access: "owner" | "shared" = "owner";
  center.registerProvider({ id: "shared", name: "Shared", description: "test", supportsInbound: true, supportsOutbound: true, conversationAccess: async () => access });
  const { channel, secret } = await center.createChannel({ provider: "shared", name: "Chat", agentPreset: "standard" });
  const conversation = { key: "group-a", kind: "group" as const };
  const first = await center.acceptInbound(channel.id, secret, { id: "owner-message", text: "private context", conversation });
  access = "shared";
  const second = await center.acceptInbound(channel.id, secret, { id: "member-message", text: "hello", conversation });
  expect(second.sessionId).not.toBe(first.sessionId);
  const sharedScope = JSON.stringify(["shared", "group", "group-a"]);
  const history = await lifecycle.history({ plugin: "shared", entry: channel.id, scope: sharedScope });
  expect(history.map(segment => segment.sessionId)).toEqual([second.sessionId]);
  const options = create.mock.calls[1]![0] as unknown as { seed: Array<{ type: string; data: unknown }> };
  expect(options.seed).toContainEqual(expect.objectContaining({ type: "amiba/shared-conversation", data: { sessionId: second.sessionId, origin: { plugin: "shared", entry: channel.id, scope: sharedScope } } }));
  expect(await center.conversationForSession(channel.id, first.sessionId)).toMatchObject({ superseded: true });
  const grants = [{ reference: "shared-document", title: "Group document" }];
  await center.shareConversationResources(channel.id, conversation.key, grants);
  expect(await lifecycle.sharedResources({ plugin: "shared", entry: channel.id, scope: sharedScope })).toEqual(grants);
  expect(await lifecycle.sharedResources({ plugin: "shared", entry: channel.id, scope: "group-a" })).toEqual([]);
  await expect(center.shareConversationResources("different-channel", conversation.key, grants)).rejects.toThrow("conversation_not_found");
  await center.shareConversationResources(channel.id, conversation.key, []);
  expect(await lifecycle.sharedResources({ plugin: "shared", entry: channel.id, scope: sharedScope })).toEqual([]);
});

it("pins connector conversation titles once, using the session creation time", async () => {
  const { center, reflectServices, live } = await harness();
  const rename = vi.fn();
  reflectServices.set("sessionTitle", { rename });
  center.registerProvider({ id: "connector-lark", name: "飞书", description: "", supportsInbound: true, supportsOutbound: true });
  const { channel, secret } = await center.createChannel({ provider: "connector-lark", name: "工作飞书", agentPreset: "standard" });
  const first = await center.acceptInbound(channel.id, secret, { id: "title-1", text: "hi", conversation: { key: "chat", kind: "p2p" } });
  expect(rename).toHaveBeenCalledWith(live.get(first.sessionId)!.session, "工作飞书 · 2026-09-12 14:30");
  await center.acceptInbound(channel.id, secret, { id: "title-2", text: "again", conversation: { key: "chat", kind: "p2p" } });
  expect(rename).toHaveBeenCalledOnce();
});

it("keeps each sender's nickname on the relayed message and the durable retry record", async () => {
  const { center, followup } = await harness();
  const { channel, secret } = await center.createChannel({ provider: "webhook", name: "工作账号", sessionId: "session-a" });
  for (const [id, senderName] of [["nick-1", "张三"], ["nick-2", "李四"]]) {
    await center.acceptInbound(channel.id, secret, { id: id!, text: "你好", sender: id, metadata: { senderName } });
  }
  expect(followup.mock.calls.map(call => call[0].source.senderName)).toEqual(["张三", "李四"]);
  expect((await center.store.listPending("session-a")).map(row => row.metadata?.senderName)).toEqual(["张三", "李四"]);
});

describe("desktop transport sync", () => {
  it.each(["connector-lark", "connector-dingtalk", "connector-weixin"])("routes %s desktop inputs without rerunning the agent; deduplicates mixed IM replies", async provider => {
    const { center, live, followup } = await harness();
    const deliver = vi.fn(async () => undefined);
    center.registerProvider({ id: provider, name: provider, description: "sync", supportsInbound: true, supportsOutbound: true, deliver });
    const { channel, secret } = await center.createChannel({ provider, name: "sync", sessionId: "session-a" });
    const binding = await center.store.bindConversation({ channelId: channel.id, conversationKey: "chat", kind: "p2p", sessionId: "session-a" });
    const { syncScope } = await import("./desktop-sync.js");
    await center.store.configureSync(syncScope(binding), { enabled: true, since: 0, floors: {} });
    await center.acceptInbound(channel.id, secret, { id: "im-input", text: "also this" });
    const [pending] = await center.store.listPending("session-a");
    const agent = live.get("session-a") as { session: { id: string; events: unknown[] } };
    agent.session.events = [
      { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
      { seq: 1, time: 2, type: "user/message", data: { id: "desktop", source: { kind: "user" }, content: "Budget 50k" } },
      { seq: 2, time: 3, type: "user/message", data: { id: pending.dshMessageId, source: { kind: "plugin", form: "relay" }, content: "also this" } },
      { seq: 3, time: 4, type: "assistant/message", data: { turn: 1, message: { id: "reply", content: "Updated" } } },
      { seq: 4, time: 5, type: "turn/end", data: { turn: 1, reason: "completed" } },
    ];
    const reconcile = (center as unknown as { reconcileSession(session: unknown): Promise<void> }).reconcileSession.bind(center);
    await reconcile(agent.session);
    await reconcile(agent.session);
    await (center as unknown as { pumpDeliveries(): Promise<void> }).pumpDeliveries();
    expect(deliver.mock.calls.map(call => (call as unknown as [unknown, { sync: { author: string } }])[1].sync.author)).toEqual(["user", "assistant"]);
    expect(followup).toHaveBeenCalledTimes(1); // Only the actual IM inbound.
    expect(await center.store.listPending()).toEqual([]);
  });

  it("blocks later mirrored replies when transport is unavailable, then retries in order", async () => {
    const { center } = await harness();
    const deliver = vi.fn(async () => { throw new Error("session_webhook_unavailable"); });
    center.registerProvider({ id: "sync-test", name: "sync", description: "", supportsInbound: true, supportsOutbound: true, deliver });
    const { channel } = await center.createChannel({ provider: "sync-test", name: "sync", sessionId: "session-a" });
    const binding = await center.store.bindConversation({ channelId: channel.id, conversationKey: "chat", kind: "p2p", sessionId: "session-a" });
    const { projectDesktopSync, syncScope } = await import("./desktop-sync.js");
    const policy = { enabled: true, since: 0, floors: {} };
    await center.store.configureSync(syncScope(binding), policy);
    const events = [
      { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
      { seq: 1, time: 2, type: "user/message", data: { id: "desktop", source: { kind: "user" }, content: "hello" } },
      { seq: 2, time: 3, type: "assistant/message", data: { turn: 1, message: { content: "reply" } } },
      { seq: 3, time: 4, type: "turn/end", data: { turn: 1 } },
    ];
    for (const row of projectDesktopSync("session-a", events as never, binding, policy)) await center.store.queueOutbound(row);
    const pump = () => (center as unknown as { pumpDeliveries(): Promise<void> }).pumpDeliveries();
    await pump();
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await center.store.listOutbox()).toHaveLength(2);
    deliver.mockImplementation(async () => undefined as never);
    await center.store.retryDeliveries(channel.id, (await center.store.listOutbox()).map(row => row.id));
    await pump();
    expect(deliver).toHaveBeenCalledTimes(3);
    expect(await center.store.listOutbox()).toEqual([]);
  });
});

it("opts in from current position, survives rotation, recovers a cold log without waking an agent, and cancels pending mirrors", async () => {
  const { center, reflectServices, live, ctx, followup } = await harness();
  const root = await mkdtemp(join(tmpdir(), "amiba-sync-lifecycle-"));
  roots.push(root);
  reflectServices.set("amibaConversations", new ConversationLifecycle(root));
  center.registerProvider({ id: "sync-cold", name: "sync", description: "", supportsInbound: true, supportsOutbound: true,
    deliver: async () => { throw new Error("session_webhook_unavailable"); } });
  const { channel, secret } = await center.createChannel({ provider: "sync-cold", name: "sync", agentPreset: "standard" });
  const conversation = { key: "owner", kind: "p2p" as const };
  const first = await center.acceptInbound(channel.id, secret, { id: "im-first", text: "hi", conversation });
  const agent = live.get(first.sessionId) as { session: { events: unknown[] } };
  const now = Date.now();
  agent.session.events = [{ seq: 0, time: now, type: "user/message", data: { id: "old", source: { kind: "user" }, content: "do not backfill" } }];
  const initial = await center.conversationSettings(channel.id, "owner", { action: "status" });
  expect(initial.desktopSync?.enabled).toBe(false);
  await center.conversationSettings(channel.id, "owner", { action: "configure", desktopSync: true });
  const events = [...agent.session.events, { seq: 1, time: Date.now() + 1, type: "user/message", data: { id: "new", source: { kind: "user" }, content: "sync me" } }];
  live.delete(first.sessionId);
  ctx.sessionPersistence.inspect.mockImplementation(async id => {
    if (id !== first.sessionId) throw new Error("session_not_found");
    return { meta: { id, agentPreset: "standard" }, events } as never;
  });
  await (center as unknown as { recoverSync(): Promise<void> }).recoverSync();
  await (center as unknown as { pumpDeliveries(): Promise<void> }).pumpDeliveries();
  const synced = await center.conversationSettings(channel.id, "owner", { action: "status" });
  expect(synced.desktopSync?.messages.map(row => row.sourceMessageId)).toEqual(["new"]);
  expect(followup).toHaveBeenCalledTimes(1);
  await center.conversationSettings(channel.id, "owner", { action: "new" });
  await center.acceptInbound(channel.id, secret, { id: "im-next", text: "next", conversation });
  expect((await center.conversationSettings(channel.id, "owner", { action: "status" })).desktopSync?.enabled).toBe(true);
  await center.conversationSettings(channel.id, "owner", { action: "configure", desktopSync: false });
  expect((await center.conversationSettings(channel.id, "owner", { action: "status" })).desktopSync?.messages[0].state).toBe("cancelled");
  await (center as unknown as { pumpDeliveries(): Promise<void> }).pumpDeliveries();
  expect((await center.store.listOutbox()).filter(row => row.envelope.sync)).toEqual([]);
});
