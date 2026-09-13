import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  MessageChannelCenter,
  MessageCenterStore,
} from "@amiba/dsh-plugin-messaging-core";
import {
  ConnectorCenter,
  ConnectorStore,
} from "@amiba/dsh-plugin-connector-core";
import { createWeixinProvider } from "./provider.js";
import { configSchema, WeixinApi } from "./api.js";
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

it("delivers iLink messages through real connector/session/outbox routing", async () => {
  const root = await mkdtemp(join(tmpdir(), "weixin-integration-"));
  const agents = fakeAgentsCtx();
  const messages = new MessageChannelCenter(
    agents.ctx as never,
    new MessageCenterStore(join(root, "messages")),
  );
  const center = new ConnectorCenter(
    { logger: () => ({ error: vi.fn() }) } as never,
    new ConnectorStore(join(root, "connectors")),
    messages,
    fakeCredentials() as never,
    new Map(),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const sent: any[] = [];
  const api = new WeixinApi(async (url, init) => {
    if (String(url).endsWith("getupdates")) {
      if (first) {
        first = false;
        await gate;
        return Response.json({
          msgs: [
            {
              message_id: "one",
              message_type: 1,
              from_user_id: "owner",
              context_token: "context",
              item_list: [{ type: 1, text_item: { text: "hello agent" } }],
            },
          ],
          get_updates_buf: "cursor",
        });
      }
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(new Error("stopped")),
          { once: true },
        ),
      );
    }
    if (String(url).endsWith("sendmessage"))
      sent.push(JSON.parse(init!.body as string).msg);
    return Response.json({ ret: 0 });
  });
  center.registerProvider(
    createWeixinProvider({ root: join(root, "weixin"), api }),
  );
  try {
    const connection = await center.createConnect({
      provider: "weixin",
      name: "My Weixin",
      config: configSchema.parse({
        botToken: "private",
        botId: "bot",
        userId: "owner",
      }),
      agentPreset: "standard",
    });
    release();
    await vi.waitFor(() => expect(agents.followup).toHaveBeenCalledTimes(1));
    expect((await center.listConnects())[0].owners).toEqual(["owner"]);
    const sessionId = agents.created[0].sessionId;
    const [pending] = await messages.store.listPending(sessionId);
    expect(pending.text).toBe("hello agent");
    const events = [
      { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
      {
        seq: 1,
        time: 2,
        type: "user/message",
        data: {
          id: pending.dshMessageId,
          role: "user",
          content: [{ type: "text", text: "hello agent" }],
          source: {
            kind: "plugin",
            plugin: `amiba-message:${pending.channelId}`,
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
            id: "answer",
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
    const agent = agents.live.get(sessionId) as {
      session: { events: unknown[] };
    };
    agent.session.events = events;
    agents.listeners.get("session/event")?.(
      agent.session as never,
      events[3] as never,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      to_user_id: "owner",
      context_token: "context",
      item_list: [{ type: 1, text_item: { text: "done!" } }],
    });
    const details = await center.getConnectDetails(connection.id);
    expect(JSON.stringify(details)).not.toContain("private");
    expect(details.messaging?.conversations[0].sessionId).toBe(sessionId);
    await center.setEnabled(connection.id, false);
    expect((await center.listConnects())[0].status.state).toBe("off");
  } finally {
    release();
    await center.stop();
    await rm(root, { recursive: true, force: true });
  }
});
