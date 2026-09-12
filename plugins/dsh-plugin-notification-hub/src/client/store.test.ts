import { afterEach, describe, it, expect, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { AmibaNotificationHub } from "../hub.js";
import { createNotificationClient } from "./store.js";
import type { NotificationRemote } from "../remote.js";
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
});
const drain = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function harness() {
  let hub = new AmibaNotificationHub({
    logger: { warn: vi.fn() },
  } as unknown as Context);
  cleanup.push(() => hub.dispose());
  const remote: NotificationRemote = {
    watch: vi.fn(async (c, s) => ({
      ok: true as const,
      value: await hub.watch(c, s),
    })),
    cancelWatch: async (s) => {
      hub.cancelWatch(s);
      return { ok: true, value: true };
    },
    dismiss: async (id) => {
      hub.dismiss(id);
      return { ok: true, value: true };
    },
    markSessionsRead: vi.fn(async (reads) => {
      hub.markSessionsRead(reads);
      return { ok: true as const, value: true };
    }),
  };
  return {
    get hub() {
      return hub;
    },
    remote,
    restart() {
      hub.dispose();
      hub = new AmibaNotificationHub({
        logger: { warn: vi.fn() },
      } as unknown as Context);
    },
  };
}
describe("shared notification transport, without pet UI", () => {
  it("synchronizes two independent consumers immediately without a polling interval", async () => {
    const h = harness();
    const a = createNotificationClient(h.remote),
      b = createNotificationClient(h.remote);
    cleanup.push(a.dispose, b.dispose);
    await drain();
    const { id } = h.hub.post({ title: "Notice", source: "test" });
    await drain();
    expect(a.getSnapshot()[0].id).toBe(id);
    expect(b.getSnapshot()[0].id).toBe(id);
    await a.dismiss(id);
    await drain();
    expect(b.getSnapshot()[0].dismissedAt).toBeDefined();
    const calls = vi.mocked(h.remote.watch).mock.calls.length;
    await drain();
    expect(vi.mocked(h.remote.watch).mock.calls.length).toBe(calls);
  });
  it("resynchronizes after restart and replays read watermarks without a desktop bridge", async () => {
    const h = harness();
    const client = createNotificationClient(h.remote);
    cleanup.push(client.dispose);
    await drain();
    h.hub.post({ title: "Task", source: "test", sessionId: "s" });
    await drain();
    client.markSessionsRead([{ sessionId: "s", readAt: Date.now() }]);
    await drain();
    expect(h.hub.list()[0].readAt).toBeDefined();
    h.restart();
    client.resync();
    await drain();
    expect(client.getSnapshot()).toEqual([]);
    expect(h.remote.markSessionsRead).toHaveBeenCalledTimes(2);
  });
  it("backs off after a disconnect and does not accept a stale response after disposal", async () => {
    vi.useFakeTimers();
    const h = harness();
    vi.mocked(h.remote.watch).mockRejectedValueOnce(new Error("offline"));
    const client = createNotificationClient(h.remote);
    cleanup.push(client.dispose);
    await drain();
    expect(h.remote.watch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(h.remote.watch).toHaveBeenCalledTimes(3);
    client.dispose();
    h.hub.post({ title: "Late", source: "test" });
    await drain();
    expect(client.getSnapshot()).toEqual([]);
  });
});

it("exposes initial loading and reconnects before trusting execution status again", async () => {
  vi.useFakeTimers();
  const h = harness(), client = createNotificationClient(h.remote);
  cleanup.push(client.dispose);
  expect(client.getConnectionSnapshot()).toBe("loading");
  await drain();
  expect(client.getConnectionSnapshot()).toBe("connected");
  vi.mocked(h.remote.watch).mockRejectedValueOnce(new Error("Disconnected"));
  client.resync();
  await drain();
  expect(client.getConnectionSnapshot()).toBe("reconnecting");
  await vi.advanceTimersByTimeAsync(250);
  await drain();
  expect(client.getConnectionSnapshot()).toBe("connected");
});
