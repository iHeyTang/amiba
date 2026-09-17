import { afterEach, expect, it, vi } from "vitest";
import { createExternalSessionGroup } from "./session-group.js";
afterEach(() => vi.useRealTimers());
it("names external sessions by connector and creation time, preserves manual names and survives reconnects", async () => {
  vi.useFakeTimers();
  const createdAt = new Date(2026, 8, 12, 14, 30).getTime();
  const classify = vi.fn().mockResolvedValue([{ id: "lark", connectorName: "飞书", createdAt }, { id: "ding", connectorName: "钉钉", createdAt }]);
  const group = createExternalSessionGroup(classify);
  const session = { id: "lark", title: "old" };
  const listener = vi.fn();
  group.face.subscribe!(listener);
  expect(group.face.claim(session)).toBe(false);
  group.face.claim({ id: "ding", title: "" });
  group.face.claim({ id: "local", title: "飞书" });
  await vi.advanceTimersByTimeAsync(0);
  expect(group.face.claim(session)).toBe(true);
  expect(group.face.claim({ id: "local", title: "飞书" })).toBe(false);
  expect(group.face.title!(session)).toBe("飞书 · 2026-09-12 14:30");
  expect(group.face.title!({ ...session, titleManual: true })).toBeUndefined();
  expect(group.face.title!({ id: "ding", title: "" })).toBe("钉钉 · 2026-09-12 14:30");
  classify.mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(15000);
  expect(group.face.claim(session)).toBe(true);
  expect(listener).toHaveBeenCalledOnce();
  group.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("batches large histories and retries sessions whose first message has not arrived", async () => {
  vi.useFakeTimers();
  const classify = vi.fn().mockResolvedValue([]);
  const group = createExternalSessionGroup(classify);
  for (let i = 0; i < 205; i++) group.face.claim({ id: String(i), title: "" });
  await vi.advanceTimersByTimeAsync(0);
  expect(classify.mock.calls.map(call => call[0].length)).toEqual([100, 100, 5]);
  classify.mockResolvedValue([{ id: "0", connectorName: "飞书", createdAt: 1 }]);
  await vi.advanceTimersByTimeAsync(15000);
  expect(group.face.claim({ id: "0", title: "" })).toBe(true);
  group.dispose();
});
it("caps idle claimed sessions so the periodic classification stays bounded", async () => {
  vi.useFakeTimers();
  const classify = vi.fn().mockResolvedValue([]);
  const group = createExternalSessionGroup(classify);
  // Burst-claim far more than the 200 cap: nothing is idle yet, so nothing is
  // evicted and every claimed session still gets classified.
  for (let i = 0; i < 205; i++) group.face.claim({ id: String(i), title: "" });
  await vi.advanceTimersByTimeAsync(0);
  expect(classify.mock.calls[0][0]).toHaveLength(100);
  expect(group.face.claim({ id: "200", title: "" })).toBe(false);

  // Wait past the idle threshold and claim one more session: the cap now
  // evicts the oldest idle non-members, so the next classification stays
  // within the cap instead of growing with every historical session.
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
  classify.mockClear();
  group.face.claim({ id: "999", title: "" });
  await vi.advanceTimersByTimeAsync(0);
  const total = classify.mock.calls.reduce((sum, call) => sum + call[0].length, 0);
  expect(total).toBeLessThanOrEqual(200);
  expect(classify.mock.calls[0][0]).not.toContain("999");

  // A dropped entry is re-added by the next claim and classified again.
  group.face.claim({ id: "0", title: "" });
  await vi.advanceTimersByTimeAsync(0);
  expect(classify.mock.calls.at(-1)![0]).toContain("0");
  group.dispose();
});
