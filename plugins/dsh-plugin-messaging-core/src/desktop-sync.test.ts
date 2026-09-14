import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { projectDesktopSync, syncScope, syncText } from "./desktop-sync.js";
import { MessageCenterStore, type StoredConversationBinding } from "./store.js";

const binding: StoredConversationBinding = {
  channelId: "channel",
  conversationKey: "chat",
  kind: "p2p",
  sessionId: "session",
  createdAt: "",
  updatedAt: "",
};
const policy = { enabled: true, since: 1, floors: {} };
const event = (seq: number, type: string, data: unknown): SessionEvent =>
  ({ seq, time: seq + 10, type, data }) as SessionEvent;
const events = [
  event(0, "turn/start", { turn: 1 }),
  event(1, "user/message", {
    id: "desktop",
    source: { kind: "user" },
    content: [{ type: "text", text: "Budget 50k" }],
  }),
  event(2, "user/message", {
    id: "notice",
    source: { kind: "plugin", form: "notice" },
    content: "secret context",
  }),
  event(3, "assistant/message", {
    turn: 1,
    message: { id: "reply", content: [{ type: "text", text: "Updated" }] },
  }),
  event(4, "turn/end", { turn: 1 }),
];

describe("desktop sync projection", () => {
  it("preserves authors, waits for final completion and never copies injected context", () => {
    expect(
      projectDesktopSync("session", events.slice(0, 4), binding, policy).map(
        (row) => row.sync.author,
      ),
    ).toEqual(["user"]);
    const projected = projectDesktopSync("session", events, binding, policy);
    expect(projected.map((row) => row.sync.author)).toEqual([
      "user",
      "assistant",
    ]);
    expect(projected[0].text).toContain("Budget 50k");
    expect(JSON.stringify(projected)).not.toContain("secret context");
    expect(projected[1].sync.turn).toBe(1);
  });
  it("does not backfill old inputs, IM inputs, or replies to them", () => {
    expect(
      projectDesktopSync("session", events, binding, {
        ...policy,
        floors: { session: 1 },
      }),
    ).toEqual([]);
    expect(
      projectDesktopSync("session", events, binding, {
        ...policy,
        enabled: false,
      }),
    ).toEqual([]);
    const im = events.map((e) =>
      e.seq === 1
        ? event(1, "user/message", {
            source: {
              kind: "plugin",
              form: "relay",
              plugin: "amiba-message:channel",
            },
            content: "IM",
          })
        : e,
    );
    expect(projectDesktopSync("session", im, binding, policy)).toEqual([]);
  });
  it("redacts attachment internals and separates platform/account/privacy destinations", () => {
    expect(
      syncText(
        'Look\n<file-attachment>\nName: "plan.pdf"\nAttachment-ID: "secret"\n</file-attachment>',
      ),
    ).not.toContain("secret");
    const original = projectDesktopSync("session", events, binding, policy)[0];
    for (const changed of [
      { ...binding, channelId: "other" },
      { ...binding, conversationKey: "other" },
      { ...binding, access: "shared" as const },
    ])
      expect(
        projectDesktopSync("session", events, changed, policy)[0].id,
      ).not.toBe(original.id);
  });
  it("delivers each message once across store restarts; disabling cancels pending without losing sent records", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-sync-test-"));
    try {
      const store = new MessageCenterStore(root);
      const rows = projectDesktopSync("session", events, binding, policy);
      await store.configureSync(syncScope(binding), policy);
      await store.queueOutbound(rows[0]);
      await store.markDelivered(rows[0].id);
      const restarted = new MessageCenterStore(root);
      await restarted.queueOutbound(rows[0]);
      expect(await restarted.listOutbox()).toEqual([]);
      await restarted.queueOutbound(rows[1]);
      await restarted.configureSync(syncScope(binding), {
        ...policy,
        enabled: false,
      });
      expect(await restarted.listOutbox()).toEqual([]);
      expect(
        (await restarted.syncStatus(syncScope(binding))).messages.map(
          (row) => row.state,
        ),
      ).toEqual(["sent", "cancelled"]);
      await restarted.queueOutbound(rows[1]);
      expect(await restarted.listOutbox()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
