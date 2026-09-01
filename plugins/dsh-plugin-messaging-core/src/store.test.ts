import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MessageCenterStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeStore() {
  const root = await mkdtemp(join(tmpdir(), "amiba-msg-store-"));
  roots.push(root);
  return { root, store: new MessageCenterStore(root) };
}

describe("conversation bindings", () => {
  it("upserts, finds, lists and removes bindings per channel", async () => {
    const { store } = await makeStore();
    const { channel } = await store.create({
      provider: "connector-fake",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    expect(channel.sessionId).toBe("");
    expect(channel.agentPreset).toBe("restricted");

    const bound = await store.bindConversation({
      channelId: channel.id,
      conversationKey: "chat-1",
      kind: "p2p",
      sessionId: "session-x",
    });
    expect(bound.sessionId).toBe("session-x");
    expect(await store.findConversation(channel.id, "chat-1")).toMatchObject({
      sessionId: "session-x",
      kind: "p2p",
    });
    expect(await store.findConversationBySession("session-x")).toMatchObject({
      conversationKey: "chat-1",
    });

    // upsert: rebinding the same key replaces the session, keeps one row
    await store.bindConversation({
      channelId: channel.id,
      conversationKey: "chat-1",
      kind: "p2p",
      sessionId: "session-y",
    });
    expect(await store.listConversations(channel.id)).toHaveLength(1);
    expect(
      (await store.findConversation(channel.id, "chat-1"))?.sessionId,
    ).toBe("session-y");

    expect(await store.removeConversation(channel.id, "chat-1")).toBe(true);
    expect(await store.findConversation(channel.id, "chat-1")).toBeUndefined();
    expect(await store.removeConversation(channel.id, "chat-1")).toBe(false);
  });

  it("drops a channel's bindings when the channel is removed", async () => {
    const { store } = await makeStore();
    const { channel } = await store.create({
      provider: "connector-fake",
      name: "Fake connect",
      agentPreset: "restricted",
    });
    await store.bindConversation({
      channelId: channel.id,
      conversationKey: "chat-1",
      kind: "group",
      title: "Team chat",
      sessionId: "session-x",
    });
    await store.remove(channel.id);
    expect(await store.listConversations()).toHaveLength(0);
  });

  it("loads a version-1 document that predates the conversations field", async () => {
    const { root, store } = await makeStore();
    // Seed a legacy file: no `conversations` key at all.
    await writeFile(
      join(root, "message-center.json"),
      JSON.stringify({
        version: 1,
        channels: [],
        receipts: [],
        pending: [],
        outbox: [],
      }),
      "utf8",
    );
    expect(await store.listConversations()).toEqual([]);
    const { channel } = await store.create({
      provider: "webhook",
      name: "Legacy",
      sessionId: "session-a",
    });
    expect(channel.sessionId).toBe("session-a");
    const raw = JSON.parse(await readFile(join(root, "message-center.json"), "utf8"));
    expect(Array.isArray(raw.conversations)).toBe(true);
  });
});
