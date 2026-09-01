import { describe, expect, it, vi } from "vitest";
import type {
  ConnectorHandle,
  ConnectorInboundEnvelope,
  ConnectorStatus,
} from "@amiba/dsh-plugin-connector-core";

import {
  createDingtalkProvider,
  handleRobotFrame,
  type DingtalkClientHandlers,
  type DingtalkDeps,
  type DwLike,
} from "./provider.js";
import type { DingtalkConnectorConfig } from "./translate.js";

const validConfig: DingtalkConnectorConfig = {
  clientId: "dt_client_1",
  clientSecret: "dt_secret_1",
  enableTools: false,
};

/** Waits a macrotask tick so any queued microtasks (e.g. a `.catch()` on a
 * fire-and-forget promise) have had a chance to run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeClient(overrides: Partial<DwLike> = {}): DwLike {
  return {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    ...overrides,
  };
}

/** Captures every call the provider core makes into the deps seam. */
function fakeDeps(options?: {
  client?: DwLike;
  token?: ReturnType<typeof vi.fn>;
  postWebhook?: ReturnType<typeof vi.fn>;
}): DingtalkDeps & {
  handlers?: DingtalkClientHandlers;
  createClient: ReturnType<typeof vi.fn>;
  token: ReturnType<typeof vi.fn>;
  postWebhook: ReturnType<typeof vi.fn>;
  logs: string[];
} {
  const client = options?.client ?? fakeClient();
  const logs: string[] = [];
  const deps: DingtalkDeps & {
    handlers?: DingtalkClientHandlers;
    createClient: ReturnType<typeof vi.fn>;
    token: ReturnType<typeof vi.fn>;
    postWebhook: ReturnType<typeof vi.fn>;
    logs: string[];
  } = {
    createClient: vi.fn(
      (_config: DingtalkConnectorConfig, handlers: DingtalkClientHandlers) => {
        deps.handlers = handlers;
        return client;
      },
    ),
    token: options?.token ?? vi.fn(async () => undefined),
    postWebhook: options?.postWebhook ?? vi.fn(async () => undefined),
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

/** Shape mirrors `OutboundMessageEnvelope` (not imported: this plugin's
 * dependency graph doesn't reach `@amiba/dsh-plugin-messaging-core` directly,
 * mirroring connector-lark's provider.test.ts, which also builds these
 * inline and lets `runtime.deliver`'s own parameter type check the shape). */
function outbound(overrides: Record<string, unknown> = {}) {
  return {
    id: "out-1",
    channelId: "channel-1",
    sessionId: "session-1",
    inReplyTo: "msg_1",
    text: "pong",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const rawTextMessage = (overrides: Record<string, unknown> = {}) => ({
  msgId: "msg_1",
  msgtype: "text",
  text: { content: "hello" },
  conversationId: "cid_1",
  conversationType: "1",
  senderStaffId: "staff_1",
  sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
  sessionWebhookExpiredTime: Date.now() + 100_000,
  ...overrides,
});

describe("createDingtalkProvider", () => {
  it("has the expected static shape and no onboard method", () => {
    const provider = createDingtalkProvider(fakeDeps());
    expect(provider.id).toBe("dingtalk");
    expect(typeof provider.name).toBe("string");
    expect(provider.configSchema).toBeDefined();
    expect(typeof provider.onboard).toBe("undefined");
    expect(provider.capabilities(validConfig)).toEqual([]);
  });

  // --- Contract item 3: validate() -------------------------------------

  describe("validate", () => {
    it("throws on a malformed config without calling deps.token", async () => {
      const deps = fakeDeps();
      const provider = createDingtalkProvider(deps);
      await expect(
        provider.validate({ clientId: "", clientSecret: "", enableTools: "nope" }),
      ).rejects.toThrow();
      expect(deps.token).not.toHaveBeenCalled();
    });

    it("propagates deps.token's failure message", async () => {
      const deps = fakeDeps({
        token: vi.fn(async () => {
          throw new Error("invalid client secret");
        }),
      });
      const provider = createDingtalkProvider(deps);
      await expect(provider.validate(validConfig)).rejects.toThrow(
        "invalid client secret",
      );
    });

    it("resolves when the config parses and deps.token succeeds", async () => {
      const deps = fakeDeps();
      const provider = createDingtalkProvider(deps);
      await expect(provider.validate(validConfig)).resolves.toBeUndefined();
      expect(deps.token).toHaveBeenCalledWith(validConfig);
    });
  });

  // --- Contract item 4: start() status transitions + inbound wiring ----

  describe("start", () => {
    it("constructs the client and transitions connecting -> ready once connect() resolves", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);

      await provider.start(handle);

      expect(deps.createClient).toHaveBeenCalledWith(validConfig, expect.any(Object));
      expect(handle.statuses).toEqual([{ state: "connecting" }, { state: "ready" }]);
    });

    it("sets status to error and rethrows when connect() rejects", async () => {
      const client = fakeClient({
        connect: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      const deps = fakeDeps({ client });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);

      await expect(provider.start(handle)).rejects.toThrow("boom");
      expect(handle.statuses).toEqual([
        { state: "connecting" },
        { state: "error", detail: "Error: boom" },
      ]);
    });

    it("sets status to connecting, not ready, when connect() resolves but isConnected() is false", async () => {
      const client = fakeClient({ isConnected: vi.fn(() => false) });
      const deps = fakeDeps({ client });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);

      await provider.start(handle);

      expect(handle.statuses).toEqual([
        { state: "connecting" }, // constructing
        { state: "connecting" }, // connect() resolved, but not actually connected
      ]);
    });

    it("maps a deps onDown note onto a connecting status (no statusNote field exists)", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      await provider.start(handle);

      deps.handlers!.onDown?.("socket closed");

      expect(handle.statuses).toEqual([
        { state: "connecting" }, // constructing
        { state: "ready" }, // connect() resolved
        { state: "connecting" }, // onDown
      ]);
    });

    it("delivers a translatable inbound message to handle.onInbound with webhook fields stripped", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      await provider.start(handle);

      deps.handlers!.onRobotMessage(rawTextMessage());
      await flush();

      expect(handle.inbound).toEqual([
        {
          id: "msg_1",
          text: "hello",
          sender: "staff_1",
          conversation: { key: "cid_1", kind: "p2p" },
        },
      ]);
    });

    it("does not call onInbound when translateRobotMessage returns null", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      await provider.start(handle);

      deps.handlers!.onRobotMessage({ msgtype: "image" });
      await flush();

      expect(handle.onInbound).not.toHaveBeenCalled();
    });

    it("swallows a handle.onInbound rejection via deps.log without crashing", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      (handle.onInbound as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("handler exploded"),
      );
      const provider = createDingtalkProvider(deps);
      await provider.start(handle);

      expect(() => deps.handlers!.onRobotMessage(rawTextMessage())).not.toThrow();
      await flush();

      expect(deps.logs.some((line) => line.includes("handler exploded"))).toBe(true);
    });

    it("gates late client callbacks behind stop(): no status writes or inbound delivery after stop", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.stop();
      const statusesAfterStop = handle.statuses.length;

      deps.handlers!.onDown?.("late note");
      deps.handlers!.onRobotMessage(rawTextMessage({ msgId: "msg_late" }));
      await flush();

      expect(handle.statuses.length).toBe(statusesAfterStop);
      expect(handle.onInbound).not.toHaveBeenCalled();
    });
  });

  // --- Contract item 5: runtime.deliver() -------------------------------

  describe("runtime.deliver", () => {
    it("throws session_webhook_unavailable when no webhook is on file for the conversation", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await expect(
        runtime.deliver({ key: "cid_unknown", kind: "p2p" }, outbound()),
      ).rejects.toThrow("session_webhook_unavailable");
      expect(deps.postWebhook).not.toHaveBeenCalled();
    });

    it("posts to the stored session webhook with a text payload", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      deps.handlers!.onRobotMessage(rawTextMessage());
      await flush();

      await runtime.deliver({ key: "cid_1", kind: "p2p" }, outbound({ text: "pong" }));

      expect(deps.postWebhook).toHaveBeenCalledWith(
        "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
        { msgtype: "text", text: { content: "pong" } },
      );
    });

    it("stores the latest webhook per conversation, so a second message replaces the first", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      deps.handlers!.onRobotMessage(
        rawTextMessage({ sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=old" }),
      );
      await flush();
      deps.handlers!.onRobotMessage(
        rawTextMessage({
          msgId: "msg_2",
          sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=new",
        }),
      );
      await flush();

      await runtime.deliver({ key: "cid_1", kind: "p2p" }, outbound());

      expect(deps.postWebhook).toHaveBeenCalledWith(
        "https://oapi.dingtalk.com/robot/sendBySession?session=new",
        expect.any(Object),
      );
    });

    it("throws session_webhook_unavailable when the stored webhook has expired", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      deps.handlers!.onRobotMessage(
        rawTextMessage({ sessionWebhookExpiredTime: Date.now() - 1_000 }),
      );
      await flush();

      await expect(
        runtime.deliver({ key: "cid_1", kind: "p2p" }, outbound()),
      ).rejects.toThrow("session_webhook_unavailable");
      expect(deps.postWebhook).not.toHaveBeenCalled();
    });

    it("propagates a deps.postWebhook rejection instead of swallowing it", async () => {
      const deps = fakeDeps({
        postWebhook: vi.fn(async () => {
          throw new Error("outbox_send_failed");
        }),
      });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      deps.handlers!.onRobotMessage(rawTextMessage());
      await flush();

      await expect(
        runtime.deliver({ key: "cid_1", kind: "p2p" }, outbound()),
      ).rejects.toThrow("outbox_send_failed");
    });
  });

  // --- Contract item 6: runtime.stop() ----------------------------------

  describe("runtime.stop", () => {
    it("disconnects the client", async () => {
      const client = fakeClient();
      const deps = fakeDeps({ client });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.stop();

      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });

    it("is idempotent: calling stop() twice does not throw and disconnects once", async () => {
      const client = fakeClient();
      const deps = fakeDeps({ client });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.stop();
      await expect(runtime.stop()).resolves.toBeUndefined();
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });

    it("clears the stored webhook map: deliver fails after stop even for a previously-live conversation", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      deps.handlers!.onRobotMessage(rawTextMessage());
      await flush();
      await runtime.stop();

      await expect(
        runtime.deliver({ key: "cid_1", kind: "p2p" }, outbound()),
      ).rejects.toThrow("session_webhook_unavailable");
    });
  });

  // --- Contract item 7: capabilities() ----------------------------------

  describe("capabilities", () => {
    it("returns [] when enableTools is false (default)", () => {
      const provider = createDingtalkProvider(fakeDeps());
      expect(provider.capabilities(validConfig)).toEqual([]);
    });

    it("declares the dingtalk-mcp server, pinned version, when enableTools is true", () => {
      const provider = createDingtalkProvider(fakeDeps());
      const decls = provider.capabilities({ ...validConfig, enableTools: true });
      expect(decls).toHaveLength(1);
      const [decl] = decls;
      if (decl?.kind !== "mcp") throw new Error("expected mcp decl");
      expect(decl.spec).toMatchObject({
        serverName: "dingtalk",
        transport: "stdio",
        command: "npx",
        enabled: true,
      });
      if (decl.spec.transport !== "stdio") throw new Error("expected stdio spec");
      expect(decl.spec.args).toEqual(["-y", "dingtalk-mcp@1.1.21"]);
    });

    it("puts dingtalk-mcp credentials and profile selection in env, never in argv", () => {
      const provider = createDingtalkProvider(fakeDeps());
      const [decl] = provider.capabilities({ ...validConfig, enableTools: true });
      if (decl?.kind !== "mcp" || decl.spec.transport !== "stdio") {
        throw new Error("expected stdio mcp decl");
      }
      expect(decl.spec.env).toEqual({
        DINGTALK_Client_ID: validConfig.clientId,
        DINGTALK_Client_Secret: validConfig.clientSecret,
        ACTIVE_PROFILES: "dingtalk-contacts,dingtalk-calendar,dingtalk-tasks",
      });
      expect(decl.spec.args).not.toContain(validConfig.clientSecret);
    });

    it("parses config via dingtalkConfigSchema first, throwing on an invalid config before building any decl", () => {
      const provider = createDingtalkProvider(fakeDeps());
      expect(() =>
        provider.capabilities({ clientId: "", clientSecret: "", enableTools: "nope" }),
      ).toThrow();
    });
  });
});

// --- handleRobotFrame: the real TOPIC_ROBOT listener's parse+dispatch,
// extracted so a malformed frame or a throwing handler can never become an
// uncaught exception in the Electron main process. ----------------------

describe("handleRobotFrame", () => {
  it("swallows a malformed JSON frame, logs it, and never calls onRobotMessage", () => {
    const onRobotMessage = vi.fn();
    const logs: string[] = [];

    expect(() =>
      handleRobotFrame("{not valid json", { onRobotMessage }, (msg) => logs.push(msg)),
    ).not.toThrow();

    expect(onRobotMessage).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("malformed");
  });

  it("calls onRobotMessage with the parsed payload for valid JSON", () => {
    const onRobotMessage = vi.fn();
    const logs: string[] = [];

    handleRobotFrame(JSON.stringify({ msgtype: "text" }), { onRobotMessage }, (msg) =>
      logs.push(msg),
    );

    expect(onRobotMessage).toHaveBeenCalledWith({ msgtype: "text" });
    expect(logs).toHaveLength(0);
  });

  it("does not throw when the log callback is omitted", () => {
    expect(() => handleRobotFrame("{not valid json", { onRobotMessage: vi.fn() })).not.toThrow();
  });

  it("swallows and logs when onRobotMessage itself throws", () => {
    const onRobotMessage = vi.fn(() => {
      throw new Error("handler exploded");
    });
    const logs: string[] = [];

    expect(() =>
      handleRobotFrame(JSON.stringify({ msgtype: "text" }), { onRobotMessage }, (msg) =>
        logs.push(msg),
      ),
    ).not.toThrow();

    expect(logs.some((line) => line.includes("handler exploded"))).toBe(true);
  });
});
