import { expect, it, vi } from "vitest";
import { resolveWeixinRuntime } from "./index.js";
import type { WeixinRuntime } from "./provider.js";
it("selects the runtime belonging to this session, never another connected account", async () => {
  const first = {} as WeixinRuntime,
    second = {} as WeixinRuntime;
  const runtimes = new Map([
    ["first", first],
    ["second", second],
  ]);
  const connectors = {
    getConnectDetails: vi.fn(async (id: string) => ({
      connect: { enabled: true, pairing: false, owners: [id] },
      messaging: {
        conversations: [{ key: id, kind: "p2p", sessionId: `${id}-session` }],
      },
    })),
  } as never;
  expect(
    await resolveWeixinRuntime(connectors, runtimes, "second-session"),
  ).toBe(second);
  await expect(
    resolveWeixinRuntime(connectors, runtimes, "desktop-session"),
  ).rejects.toThrow("requires_weixin_conversation");
  await expect(
    resolveWeixinRuntime(connectors, runtimes, undefined),
  ).rejects.toThrow("live_session_required");
});
it.each([
  { enabled: false, pairing: false, owners: ["owner"] },
  { enabled: true, pairing: true, owners: ["owner"] },
  { enabled: true, pairing: false, owners: [] },
])("rejects disabled, unpaired and nonowner routes: %j", async (connect) => {
  const connectors = {
    getConnectDetails: vi.fn(async () => ({
      connect,
      messaging: {
        conversations: [{ key: "owner", kind: "p2p", sessionId: "session" }],
      },
    })),
  } as never;
  await expect(
    resolveWeixinRuntime(
      connectors,
      new Map([["one", {} as WeixinRuntime]]),
      "session",
    ),
  ).rejects.toThrow("requires_weixin_conversation");
});
