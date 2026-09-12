import { expect, it, vi } from "vitest";
import { ConnectorCenter } from "./center.js";
it("classifies historical sessions from persisted origin and creation time, caches stable results and retries blank logs", async () => {
  const relay = { type: "user/message", data: { source: { kind: "plugin", plugin: "amiba-message:channel-1" } } };
  const inspect = vi.fn(async (id: string) => ({ meta: { createdAt: 123, ...(id === "branch" ? { parentSession: "old" } : {}) }, events: id === "blank" ? [] : [relay] }));
  const list = vi.fn(async () => [{ channelId: "channel-1", name: "飞书" }]);
  const center = new ConnectorCenter({ reflect: { get: () => ({ inspect }) } } as never, { list } as never, {} as never, {} as never, new Map());
  expect(await center.externalSessions(["old", "old", "blank", "branch"])).toEqual([{ id: "old", connectorName: "飞书", createdAt: 123 }]);
  expect(inspect).toHaveBeenCalledTimes(3);
  inspect.mockResolvedValue({ meta: { createdAt: 456 }, events: [relay] });
  list.mockResolvedValue([{ channelId: "channel-1", name: "工作飞书" }]);
  expect(await center.externalSessions(["old", "blank", "branch"])).toEqual([
    { id: "old", connectorName: "工作飞书", createdAt: 123 },
    { id: "blank", connectorName: "工作飞书", createdAt: 456 },
  ]);
  expect(inspect).toHaveBeenCalledTimes(4);
});
it("exposes readable source metadata without channel credentials", async () => {
  const center = new ConnectorCenter({} as never, {} as never, {
    listChannels: async () => [{ id: "channel-1", provider: "connector-lark", name: "工作账号", secretHash: "secret", allowedSenders: ["private"] }],
    listProviders: () => [{ id: "connector-lark", name: "飞书 / Lark" }],
  } as never, {} as never, new Map());
  expect(await center.messageSources()).toEqual([{ id: "amiba-message:channel-1", provider: "lark", providerName: "飞书 / Lark", accountName: "工作账号" }]);
});
