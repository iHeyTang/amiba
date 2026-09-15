import { expect, it, vi } from "vitest";
import { ConnectorCenter } from "./center.js";

const relay = { type: "user/message", data: { source: { kind: "plugin", plugin: "amiba-message:channel-1" } } };

function fixture() {
  const read = vi.fn(async (id: string) => ({ events: id === "blank" ? [] : [relay] }));
  const close = vi.fn(async () => {});
  let createdAt = 123;
  const open = vi.fn(async (id: string, _access: string) => ({
    header: { createdAt, ...(id === "branch" ? { parentSession: "old" } : {}) },
    read: () => read(id),
    close,
  }));
  const list = vi.fn(async () => [{ channelId: "channel-1", name: "飞书" }]);
  // Match the current persistence contract: no legacy inspect() method.
  const center = new ConnectorCenter({ sessionPersistence: { open } } as never, { list } as never, {} as never, {} as never, new Map());
  return { center, open, read, close, list, setCreatedAt: (value: number) => { createdAt = value; } };
}

it("classifies historical sessions using read handles, caches stable origins and retries blank logs", async () => {
  const { center, open, read, close, list, setCreatedAt } = fixture();
  expect(await center.externalSessions(["old", "old", "blank", "branch"])).toEqual([{ id: "old", connectorName: "飞书", createdAt: 123 }]);
  expect(open.mock.calls).toEqual([["old", "read"], ["blank", "read"], ["branch", "read"]]);
  expect(close).toHaveBeenCalledTimes(3);
  read.mockResolvedValue({ events: [relay] });
  setCreatedAt(456);
  list.mockResolvedValue([{ channelId: "channel-1", name: "工作飞书" }]);
  expect(await center.externalSessions(["old", "blank", "branch"])).toEqual([
    { id: "old", connectorName: "工作飞书", createdAt: 123 },
    { id: "blank", connectorName: "工作飞书", createdAt: 456 },
  ]);
  expect(open).toHaveBeenCalledTimes(4);
  expect(close).toHaveBeenCalledTimes(4);
});

it("closes failed reads and retries them without losing other external sessions", async () => {
  const { center, open, read, close } = fixture();
  read.mockRejectedValueOnce(new Error("temporarily unavailable"));
  expect(await center.externalSessions(["failed", "old"])).toEqual([
    { id: "old", connectorName: "飞书", createdAt: 123 },
  ]);
  expect(close).toHaveBeenCalledTimes(2);
  expect(await center.externalSessions(["failed", "old"])).toEqual([
    { id: "failed", connectorName: "飞书", createdAt: 123 },
    { id: "old", connectorName: "飞书", createdAt: 123 },
  ]);
  expect(open).toHaveBeenCalledTimes(3);
  expect(close).toHaveBeenCalledTimes(3);
});

it("retries failed opens and reports unavailable persistence", async () => {
  const { center, open, close } = fixture();
  open.mockRejectedValueOnce(new Error("temporarily unavailable"));
  expect(await center.externalSessions(["old"])).toEqual([]);
  expect(close).not.toHaveBeenCalled();
  expect(await center.externalSessions(["old"])).toEqual([
    { id: "old", connectorName: "飞书", createdAt: 123 },
  ]);
  const unavailable = new ConnectorCenter({} as never, {} as never, {} as never, {} as never, new Map());
  await expect(unavailable.externalSessions(["old"])).rejects.toThrow("session_persistence_unavailable");
});

it("exposes readable source metadata without channel credentials", async () => {
  const center = new ConnectorCenter({} as never, {} as never, {
    listChannels: async () => [{ id: "channel-1", provider: "connector-lark", name: "工作账号", secretHash: "secret", allowedSenders: ["private"] }],
    listProviders: () => [{ id: "connector-lark", name: "飞书 / Lark" }],
  } as never, {} as never, new Map());
  expect(await center.messageSources()).toEqual([{ id: "amiba-message:channel-1", provider: "lark", providerName: "飞书 / Lark", accountName: "工作账号" }]);
});
