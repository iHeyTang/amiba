import { afterEach, expect, it, vi } from "vitest";
import { createConnectorMessageSource } from "./message-source.js";

afterEach(() => { vi.useRealTimers(); document.documentElement.lang = "en"; });
it("resolves historical source ids, localizes platforms, and refreshes account names without losing labels offline", async () => {
  vi.useFakeTimers();
  document.documentElement.lang = "zh-CN";
  const row = { id: "amiba-message:channel-old", provider: "lark", providerName: "飞书 / Lark", accountName: "工作账号" };
  const load = vi.fn().mockResolvedValue([row]);
  const source = createConnectorMessageSource(load);
  const listener = vi.fn();
  source.face.subscribe!(listener);
  expect(source.face.resolve(row.id)).toBe("外部消息");
  await vi.advanceTimersByTimeAsync(0);
  expect(source.face.resolve(row.id)).toBe("飞书 · 工作账号");
  expect(source.face.resolve("amiba-steward")).toBeUndefined();
  expect(source.face.resolve("amiba-message:deleted")).toBe("外部消息");
  load.mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(15000);
  expect(source.face.resolve(row.id)).toBe("飞书 · 工作账号");
  load.mockResolvedValue([{ ...row, accountName: "飞书" }]);
  await vi.advanceTimersByTimeAsync(15000);
  expect(source.face.resolve(row.id)).toBe("飞书");
  expect(listener).toHaveBeenCalledTimes(2);
  document.documentElement.lang = "en";
  expect(source.face.resolve("amiba-message:deleted")).toBe("External messages");
  source.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("supports DingTalk and other providers without leaking raw identifiers", async () => {
  vi.useFakeTimers();
  document.documentElement.lang = "zh";
  const source = createConnectorMessageSource(async () => [
    { id: "amiba-message:ding", provider: "dingtalk", providerName: "钉钉 / DingTalk", accountName: "钉钉 / DingTalk" },
    { id: "amiba-message:custom", provider: "custom", providerName: "团队聊天", accountName: "研发" },
  ]);
  await vi.advanceTimersByTimeAsync(0);
  expect(source.face.resolve("amiba-message:ding")).toBe("钉钉");
  expect(source.face.resolve("amiba-message:custom")).toBe("团队聊天 · 研发");
  document.documentElement.lang = "en";
  expect(source.face.resolve("amiba-message:ding")).toBe("DingTalk");
  source.dispose();
});
