import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageChannelCenter } from "./center.js";
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
    session: { id, header: { id, agentPreset: "standard" }, events: [] },
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
  const loggerCalls = { error: vi.fn(), warn: vi.fn() };
  const defaultModelService = {
    currentSelection: () => ({ provider: "deepseek", model: "deepseek-chat" }),
  };
  // Mirrors the real Cordis contract: messaging-core never declares
  // `agentDefaultModel` in `inject`, so it must be read via `ctx.reflect.get`
  // (a point-in-time lookup that returns undefined for an absent service)
  // rather than as a direct property — Cordis throws on a bare, un-injected
  // property ACCESS. `reflectServices` lets `harnessWithoutDefaultModel`
  // simulate the headless case by removing just this entry.
  const reflectServices = new Map<string, unknown>([
    ["agentDefaultModel", defaultModelService],
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

  it("falls back to a presetless session when mounting the agent preset fails on session creation", async () => {
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
    ).resolves.toMatchObject({ accepted: true, duplicate: false });

    expect(created).toHaveLength(1);
    expect(created[0]!.meta).toMatchObject({ agentPreset: "restricted" });
    expect(followup).toHaveBeenCalledTimes(1);
    expect(await center.listConversations(channel.id)).toHaveLength(1);
    expect(loggerCalls.warn).toHaveBeenCalledTimes(1);
    const [warning] = loggerCalls.warn.mock.calls[0]!;
    expect(String(warning)).toContain("restricted");
  });

  it("falls back to a presetless session when mounting the agent preset fails on resume", async () => {
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
    ).resolves.toMatchObject({ accepted: true, duplicate: false });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(followup).toHaveBeenCalledTimes(1);
    expect(loggerCalls.warn).toHaveBeenCalledTimes(1);
    const [warning] = loggerCalls.warn.mock.calls[0]!;
    expect(String(warning)).toContain("standard");
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
});
