import { describe, it, expect, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { AmibaNotificationHub, isNotificationVisible } from "./hub.js";
const create = () =>
  new AmibaNotificationHub({ logger: { warn: vi.fn() } } as unknown as Context);
describe("notification mechanisms without a presentation plugin", () => {
  it("pushes deltas for post, rename, read, dismiss and resolution with independent state", async () => {
    const hub = create();
    const initial = await hub.watch(null, "consumer");
    const pending = hub.watch(initial.cursor, "consumer");
    const { id } = hub.post({
      title: "Task",
      source: "test",
      sessionId: "s",
      status: "waiting",
      key: "request",
    });
    const added = await pending;
    expect(added.reset).toBe(false);
    expect(added.notifications).toHaveLength(1);
    hub.markSessionsRead([{ sessionId: "s", readAt: Date.now() }]);
    expect(hub.list()[0].readAt).toBeDefined();
    expect(hub.list()[0].resolvedAt).toBeUndefined();
    hub.dismiss(id);
    hub.renameSession("s", "Renamed");
    hub.resolve("test", "request");
    const updated = hub.updates(added.cursor).notifications[0];
    expect(updated).toMatchObject({ title: "Renamed", id });
    expect(updated.readAt).toBeDefined();
    expect(updated.dismissedAt).toBeDefined();
    expect(updated.resolvedAt).toBeDefined();
    expect(isNotificationVisible(updated)).toBe(false);
    hub.dispose();
  });
  it("never evicts unread notices or unresolved requests when trimming history", () => {
    const hub = create();
    const waiting = hub.post({
      title: "Approval",
      source: "test",
      status: "waiting",
    });
    hub.dismiss(waiting.id);
    const unread = hub.post({ title: "Unread", source: "test" });
    for (let i = 0; i < 130; i++) {
      const { id } = hub.post({ title: `old ${i}`, source: "test" });
      hub.dismiss(id);
    }
    const ids = hub.list().map((n) => n.id);
    expect(ids).toContain(waiting.id);
    expect(ids).toContain(unread.id);
    expect(ids).toHaveLength(102);
    hub.resolveNotification(waiting.id);
    expect(hub.list()).toHaveLength(101);
    hub.dispose();
  });
  it("resets after a revision gap or server restart and cancels subscriptions promptly", async () => {
    const hub = create(),
      initial = hub.updates(null);
    const pending = hub.watch(initial.cursor, "subscriber");
    hub.cancelWatch("subscriber");
    expect((await pending).notifications).toEqual([]);
    for (let i = 0; i < 260; i++)
      hub.post({ title: `Task ${i}`, source: "test" });
    expect(hub.updates(initial.cursor).reset).toBe(true);
    const restarted = create();
    expect(restarted.updates(hub.updates(null).cursor).reset).toBe(true);
    const stop = hub.watch(hub.updates(null).cursor, "subscriber");
    hub.dispose();
    await stop;
    restarted.dispose();
  });
});
