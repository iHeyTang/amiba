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
  const resume = vi.fn(
    async ({ resumeSessionId }: { resumeSessionId: string }) => {
      if (resumeSessionId !== "session-cold")
        throw new Error("session_not_found");
      const agent = makeAgent(resumeSessionId);
      live.set(resumeSessionId, agent);
      return { agent };
    },
  );
  const created: Array<{ sessionId: string; meta?: Record<string, unknown> }> = [];
  const dispose = vi.fn(async () => undefined);
  const create = vi.fn(
    async ({ sessionId, meta }: { sessionId: string; meta?: Record<string, unknown> }) => {
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
    logger: () => ({ error: vi.fn() }),
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
  return { center, followup, listeners, resume, live, created, create, dispose };
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
});
