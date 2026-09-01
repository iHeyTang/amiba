import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type {
  ConnectorHandle,
  ConnectorInboundEnvelope,
  ConnectorStatus,
} from "@amiba/dsh-plugin-connector-core";

import {
  createLarkProvider,
  type ApiLike,
  type LarkDeps,
  type LarkWsCallbacks,
  type WsLike,
} from "./provider.js";
import type { LarkConnectorConfig } from "./translate.js";
import { apply, inject, name } from "./index.js";

const validConfig: LarkConnectorConfig = {
  appId: "cli_app_1",
  appSecret: "secret_1",
  domain: "feishu",
};

function fakeApi(overrides: Partial<ApiLike> = {}): ApiLike {
  return {
    tenantToken: vi.fn(async () => undefined),
    botOpenId: vi.fn(async () => "ou_bot_123"),
    sendText: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeWs(overrides: Partial<WsLike> = {}): WsLike {
  return {
    start: vi.fn(async () => undefined),
    close: vi.fn(),
    ...overrides,
  };
}

/** Captures every call the provider core makes into the deps seam. */
function fakeDeps(options?: {
  api?: ApiLike;
  ws?: WsLike;
}): LarkDeps & {
  wsCallbacks?: LarkWsCallbacks;
  createWsClient: ReturnType<typeof vi.fn>;
  createApiClient: ReturnType<typeof vi.fn>;
  logs: string[];
} {
  const api = options?.api ?? fakeApi();
  const ws = options?.ws ?? fakeWs();
  const logs: string[] = [];
  const deps: LarkDeps & {
    wsCallbacks?: LarkWsCallbacks;
    createWsClient: ReturnType<typeof vi.fn>;
    createApiClient: ReturnType<typeof vi.fn>;
    logs: string[];
  } = {
    createApiClient: vi.fn(() => api),
    createWsClient: vi.fn((_config: LarkConnectorConfig, callbacks: LarkWsCallbacks) => {
      deps.wsCallbacks = callbacks;
      return ws;
    }),
    log: (msg: string) => logs.push(msg),
    logs,
  };
  return deps;
}

function fakeHandle(config: unknown = validConfig): ConnectorHandle & {
  statuses: ConnectorStatus[];
  inbound: ConnectorInboundEnvelope[];
} {
  const statuses: ConnectorStatus[] = [];
  const inbound: ConnectorInboundEnvelope[] = [];
  return {
    connectId: "connect-1",
    config,
    statuses,
    inbound,
    onInbound: vi.fn(async (envelope: ConnectorInboundEnvelope) => {
      inbound.push(envelope);
    }),
    setStatus: (status: ConnectorStatus) => statuses.push(status),
  };
}

describe("createLarkProvider", () => {
  it("has the expected static shape", () => {
    const provider = createLarkProvider(fakeDeps());
    expect(provider.id).toBe("lark");
    expect(typeof provider.name).toBe("string");
    expect(provider.capabilities(validConfig)).toEqual([]);
  });

  // --- Contract item 1: validate() -----------------------------------

  describe("validate", () => {
    it("throws on a malformed config without calling deps", async () => {
      const deps = fakeDeps();
      const provider = createLarkProvider(deps);
      await expect(
        provider.validate({ appId: "", appSecret: "", domain: "nope" }),
      ).rejects.toThrow();
      expect(deps.createApiClient).not.toHaveBeenCalled();
    });

    it("propagates the SDK's auth-failure message from tenantToken()", async () => {
      const api = fakeApi({
        tenantToken: vi.fn(async () => {
          throw new Error("invalid app secret");
        }),
      });
      const deps = fakeDeps({ api });
      const provider = createLarkProvider(deps);
      await expect(provider.validate(validConfig)).rejects.toThrow(
        "invalid app secret",
      );
    });

    it("resolves when the config parses and tenantToken succeeds", async () => {
      const deps = fakeDeps();
      const provider = createLarkProvider(deps);
      await expect(provider.validate(validConfig)).resolves.toBeUndefined();
    });
  });

  // --- Contract item 2: start() status transitions + inbound wiring --

  describe("start", () => {
    it("resolves botOpenId then constructs the ws client, starting in connecting state", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);

      await provider.start(handle);

      expect(deps.createApiClient).toHaveBeenCalledWith(validConfig);
      expect(deps.createWsClient).toHaveBeenCalledWith(
        validConfig,
        expect.any(Object),
      );
      expect(handle.statuses[0]).toEqual({ state: "connecting" });
    });

    it("maps ws callbacks onto handle.setStatus exactly per the contract", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      callbacks.onReady?.();
      callbacks.onReconnecting?.();
      callbacks.onReconnected?.();
      callbacks.onError?.(new Error("boom"));

      expect(handle.statuses).toEqual([
        { state: "connecting" }, // constructing
        { state: "ready" }, // onReady
        { state: "connecting" }, // onReconnecting
        { state: "ready" }, // onReconnected
        { state: "error", detail: "Error: boom" }, // onError
      ]);
    });

    it("delivers a translatable inbound event to handle.onInbound", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await callbacks.onEvent?.({
        sender: { sender_id: { open_id: "ou_user_1" } },
        message: {
          message_id: "msg_1",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hello"}',
        },
      });

      expect(handle.inbound).toEqual([
        {
          id: "msg_1",
          text: "hello",
          sender: "ou_user_1",
          conversation: { key: "oc_1", kind: "p2p" },
        },
      ]);
    });

    it("does not call onInbound when translateReceiveEvent returns null", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await callbacks.onEvent?.({
        message: {
          message_id: "msg_2",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "image",
          content: "{}",
        },
      });

      expect(handle.onInbound).not.toHaveBeenCalled();
    });

    it("swallows a handler error via deps.log without crashing the ws loop", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      (handle.onInbound as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("handler exploded"),
      );
      const provider = createLarkProvider(deps);
      await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await expect(
        callbacks.onEvent?.({
          sender: { sender_id: { open_id: "ou_user_1" } },
          message: {
            message_id: "msg_3",
            chat_id: "oc_1",
            chat_type: "p2p",
            message_type: "text",
            content: '{"text":"hello"}',
          },
        }),
      ).resolves.toBeUndefined();

      expect(deps.logs.some((line) => line.includes("handler exploded"))).toBe(
        true,
      );
    });

    it("gates late ws callbacks behind stop(): no status writes or inbound delivery after stop", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.stop();
      const statusesAfterStop = handle.statuses.length;

      // Fire every callback as if it raced the initial connect attempt and
      // only landed after stop() had already resolved and the center had
      // already torn down this connect's status entry.
      const callbacks = deps.wsCallbacks!;
      callbacks.onReady?.();
      callbacks.onReconnected?.();
      callbacks.onReconnecting?.();
      callbacks.onError?.(new Error("late boom"));
      await callbacks.onEvent?.({
        sender: { sender_id: { open_id: "ou_user_1" } },
        message: {
          message_id: "msg_late",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hello"}',
        },
      });

      expect(handle.statuses.length).toBe(statusesAfterStop);
      expect(handle.onInbound).not.toHaveBeenCalled();
    });
  });

  // --- Contract item 3: runtime.deliver() -----------------------------

  describe("runtime.deliver", () => {
    it("sends text via deps.sendText using the conversation key", async () => {
      const api = fakeApi();
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.deliver(
        { key: "oc_target", kind: "p2p" },
        {
          id: "out-1",
          channelId: "channel-1",
          sessionId: "session-1",
          inReplyTo: "msg_1",
          text: "pong",
          createdAt: new Date().toISOString(),
        },
      );

      expect(api.sendText).toHaveBeenCalledWith("oc_target", "pong");
    });

    it("propagates an SDK rejection instead of swallowing it", async () => {
      const api = fakeApi({
        sendText: vi.fn(async () => {
          throw new Error("outbox_send_failed");
        }),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      await expect(
        runtime.deliver(
          { key: "oc_target", kind: "p2p" },
          {
            id: "out-2",
            channelId: "channel-1",
            sessionId: "session-1",
            inReplyTo: "msg_1",
            text: "pong",
            createdAt: new Date().toISOString(),
          },
        ),
      ).rejects.toThrow("outbox_send_failed");
    });
  });

  // --- Contract item 4: runtime.stop() --------------------------------

  describe("runtime.stop", () => {
    it("closes the ws client with force: false", async () => {
      const ws = fakeWs();
      const deps = fakeDeps({ ws });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.stop();

      expect(ws.close).toHaveBeenCalledWith({ force: false });
    });

    it("is idempotent: calling stop() twice does not throw and closes once", async () => {
      const ws = fakeWs();
      const deps = fakeDeps({ ws });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.stop();
      await expect(runtime.stop()).resolves.toBeUndefined();
      expect(ws.close).toHaveBeenCalledTimes(1);
    });
  });
});

// --- Contract item 5: plugin entry ------------------------------------

describe("plugin entry (index.ts)", () => {
  it("declares name and inject", () => {
    expect(name).toBe("amiba-connector-lark");
    expect(inject).toEqual(["amibaConnectors"]);
  });

  it("registers createLarkProvider() via ctx.effect, wrapping the disposer", () => {
    const disposer = vi.fn();
    const registerProvider = vi.fn((_provider: unknown) => disposer);
    const effectCalls: Array<{ execute: () => unknown; label?: string }> = [];
    const ctx = {
      effect: vi.fn((execute: () => unknown, label?: string) => {
        effectCalls.push({ execute, label });
        return execute();
      }),
      amibaConnectors: { registerProvider },
    } as unknown as Context;

    apply(ctx);

    expect(ctx.effect).toHaveBeenCalledTimes(1);
    expect(effectCalls[0]?.label).toBe("amiba-connector-lark.provider");
    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(registerProvider.mock.calls[0]?.[0]).toMatchObject({ id: "lark" });
  });
});
