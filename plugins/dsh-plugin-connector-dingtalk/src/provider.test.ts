import { describe, expect, it, vi } from "vitest";
import { DWClient, TOPIC_CARD, TOPIC_ROBOT } from "dingtalk-stream";
import type {
  ConnectorHandle,
  ConnectorInboundEnvelope,
  ConnectorRuntime,
  ConnectorStatus,
} from "@amiba/dsh-plugin-connector-core";

import {
  createDingtalkProvider,
  handleCardFrame,
  handleRobotFrame,
  realDingtalkDeps,
  type DingtalkClientHandlers,
  type DingtalkDeps,
  type DwLike,
} from "./provider.js";
import { buildApprovalCardPrompt } from "./approval-card.js";
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
  createCard?: ReturnType<typeof vi.fn>;
  updateCard?: ReturnType<typeof vi.fn>;
}): DingtalkDeps & {
  handlers?: DingtalkClientHandlers;
  createClient: ReturnType<typeof vi.fn>;
  token: ReturnType<typeof vi.fn>;
  postWebhook: ReturnType<typeof vi.fn>;
  createCard?: ReturnType<typeof vi.fn>;
  updateCard?: ReturnType<typeof vi.fn>;
  logs: string[];
} {
  const client = options?.client ?? fakeClient();
  const logs: string[] = [];
  const deps: DingtalkDeps & {
    handlers?: DingtalkClientHandlers;
    createClient: ReturnType<typeof vi.fn>;
    token: ReturnType<typeof vi.fn>;
    postWebhook: ReturnType<typeof vi.fn>;
    createCard?: ReturnType<typeof vi.fn>;
    updateCard?: ReturnType<typeof vi.fn>;
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
    ...(options?.createCard ? { createCard: options.createCard } : {}),
    ...(options?.updateCard ? { updateCard: options.updateCard } : {}),
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

/** Shape mirrors `ApprovalPrompt` (not imported — same reasoning as
 * `outbound()` above: this plugin's dependency graph doesn't reach
 * `@amiba/dsh-plugin-messaging-core`). */
function approvalPrompt(overrides: Partial<{
  approvalId: string;
  seq: number;
  toolName: string;
  reason?: string;
  sessionId: string;
  signal: AbortSignal;
  deadlineAt?: number;
  canAnswer: (sender: string | undefined) => Promise<boolean>;
}> = {}) {
  return {
    approvalId: "appr_1",
    seq: 1,
    toolName: "run_shell",
    sessionId: "session-1",
    signal: new AbortController().signal,
    // Open by default (no allowlist, everyone an owner); tests that care
    // about who may answer pass their own.
    canAnswer: async () => true,
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

  // --- requestApproval() / announceApprovalOutcome() --------------------

  describe("runtime.requestApproval", () => {
    it("returns null when deps.createCard is not implemented (no native surface)", async () => {
      const deps = fakeDeps(); // no createCard
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const reply = await runtime.requestApproval!({ key: "cid_1", kind: "p2p" }, approvalPrompt());

      expect(reply).toBeNull();
    });

    it("returns null and logs when deps.createCard rejects (send failure)", async () => {
      const createCard = vi.fn(async () => {
        throw new Error("card_api_down");
      });
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const reply = await runtime.requestApproval!({ key: "cid_1", kind: "p2p" }, approvalPrompt());

      expect(reply).toBeNull();
      expect(deps.logs.some((line) => line.includes("card_api_down"))).toBe(true);
    });

    it("sends the card via deps.createCard with the conversation target and the built prompt content", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      void runtime.requestApproval!(
        { key: "cid_1", kind: "group" },
        approvalPrompt({
          approvalId: "appr_9",
          seq: 3,
          toolName: "write_file",
          reason: "needs write access",
        }),
      );
      await flush();

      expect(createCard).toHaveBeenCalledWith(
        validConfig,
        "appr_9",
        { conversationKey: "cid_1", conversationKind: "group" },
        {
          header: "需要你的审批",
          body: "#3 · write_file\nneeds write access",
          agree: { label: "同意", decision: "allowed-once" },
          reject: { label: "拒绝", decision: "rejected" },
        },
      );
    });

    it("resolves with the human's decision once a matching card callback arrives", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const pending = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_1" }),
      );
      await flush();

      deps.handlers!.onCardCallback({
        userId: "staff_9",
        params: { approvalId: "appr_1", decision: "allowed-once" },
      });

      await expect(pending).resolves.toEqual({ outcome: "allowed-once", by: "staff_9" });
    });

    it("resolves a reject decision without an operator id when the callback carries none", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const pending = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_2" }),
      );
      await flush();

      deps.handlers!.onCardCallback({ params: { approvalId: "appr_2", decision: "rejected" } });

      await expect(pending).resolves.toEqual({ outcome: "rejected", by: undefined });
    });

    it("ignores a card callback with a mismatched approvalId, keeping the request pending", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const pending = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_1" }),
      );
      await flush();

      deps.handlers!.onCardCallback({
        params: { approvalId: "some_other_approval", decision: "allowed-once" },
      });
      await flush();

      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await flush();
      expect(settled).toBe(false);

      // Settle it for real so this test doesn't leave a permanently
      // dangling promise behind.
      deps.handlers!.onCardCallback({ params: { approvalId: "appr_1", decision: "rejected" } });
      await expect(pending).resolves.toEqual({ outcome: "rejected", by: undefined });
    });

    it("ignores a second callback for an already-settled approval — the first decision wins", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const pending = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_1" }),
      );
      await flush();

      deps.handlers!.onCardCallback({
        params: { approvalId: "appr_1", decision: "allowed-once" },
        userId: "first",
      });
      deps.handlers!.onCardCallback({
        params: { approvalId: "appr_1", decision: "rejected" },
        userId: "second",
      });

      await expect(pending).resolves.toEqual({ outcome: "allowed-once", by: "first" });
    });

    it("never resolves once request.signal aborts, and a late card callback afterward is a no-op", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);
      const controller = new AbortController();

      const pending = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_1", signal: controller.signal }),
      );
      await flush();
      controller.abort();
      await flush();

      // Resolving `null` here would read as "couldn't present natively",
      // flipping messaging-core's presentation to text and skipping the
      // `announceApprovalOutcome` that still has to flip this live card.
      await expect(
        Promise.race([pending, Promise.resolve("still-pending")]),
      ).resolves.toBe("still-pending");

      expect(() =>
        deps.handlers!.onCardCallback({ params: { approvalId: "appr_1", decision: "allowed-once" } }),
      ).not.toThrow();
      await flush();
      await expect(
        Promise.race([pending, Promise.resolve("still-pending")]),
      ).resolves.toBe("still-pending");
    });

    it("sends no card at all when request.signal is already aborted before the call", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);
      const controller = new AbortController();
      controller.abort();

      const reply = await runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_1", signal: controller.signal }),
      );

      // No card exists, so nothing is orphaned and nothing is left for
      // `announceApprovalOutcome` to flip — `null` is safe (and correct)
      // only in this branch.
      expect(reply).toBeNull();
      expect(createCard).not.toHaveBeenCalled();
    });

    it("resolves every still-pending native request to null when the connect is stopped", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const pendingA = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_a" }),
      );
      const pendingB = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_b" }),
      );
      await flush();

      await runtime.stop();

      await expect(pendingA).resolves.toBeNull();
      await expect(pendingB).resolves.toBeNull();
    });

    // plan.md §2/§5: a card in a group conversation is clickable by everyone
    // who can see it, so every callback is gated on the caller's own rule.
    describe("sender gate", () => {
      async function started(canAnswer: (sender: string | undefined) => Promise<boolean>) {
        const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
        const deps = fakeDeps({ createCard });
        const provider = createDingtalkProvider(deps);
        const runtime = await provider.start(fakeHandle());
        const pending = runtime.requestApproval!(
          { key: "cid_1", kind: "group" },
          approvalPrompt({ approvalId: "appr_1", canAnswer }),
        );
        await flush();
        return { deps, pending };
      }

      it("settles on a callback from a user canAnswer admits", async () => {
        const canAnswer = vi.fn(async (sender?: string) => sender === "boss");
        const { deps, pending } = await started(canAnswer);

        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "allowed-once" },
          userId: "boss",
        });

        await expect(pending).resolves.toEqual({
          outcome: "allowed-once",
          by: "boss",
        });
        expect(canAnswer).toHaveBeenCalledWith("boss");
      });

      it("ignores a callback canAnswer refuses, keeps waiting, and warns", async () => {
        const { deps, pending } = await started(async (sender) => sender === "boss");

        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "allowed-once" },
          userId: "bystander",
        });
        await flush();

        await expect(
          Promise.race([pending, Promise.resolve("still-pending")]),
        ).resolves.toBe("still-pending");
        expect(
          deps.logs.some(
            (line) => line.includes("bystander") && line.includes("may not answer"),
          ),
        ).toBe(true);

        // Still live: an allowed user's later click settles it.
        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "rejected" },
          userId: "boss",
        });
        await expect(pending).resolves.toEqual({ outcome: "rejected", by: "boss" });
      });

      it("refuses a callback that names no user at all", async () => {
        const { deps, pending } = await started(async (sender) => sender !== undefined);

        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "allowed-once" },
        });
        await flush();

        await expect(
          Promise.race([pending, Promise.resolve("still-pending")]),
        ).resolves.toBe("still-pending");
      });

      it("refuses the callback when canAnswer itself throws", async () => {
        const { deps, pending } = await started(async () => {
          throw new Error("store_unreadable");
        });

        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "allowed-once" },
          userId: "boss",
        });
        await flush();

        await expect(
          Promise.race([pending, Promise.resolve("still-pending")]),
        ).resolves.toBe("still-pending");
        expect(deps.logs.some((line) => line.includes("store_unreadable"))).toBe(true);
      });

      it("refuses a callback naming another conversation or another card instance", async () => {
        const { deps, pending } = await started(async () => true);

        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "allowed-once" },
          userId: "boss",
          openConversationId: "cid_other",
        });
        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "allowed-once" },
          userId: "boss",
          outTrackId: "inst_other",
        });
        await flush();

        await expect(
          Promise.race([pending, Promise.resolve("still-pending")]),
        ).resolves.toBe("still-pending");
        expect(deps.logs.filter((line) => line.includes("ignoring a card callback"))).toHaveLength(2);

        // The matching conversation and instance still settle it.
        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_1", decision: "allowed-once" },
          userId: "boss",
          openConversationId: "cid_1",
          outTrackId: "inst_1",
        });
        await expect(pending).resolves.toEqual({ outcome: "allowed-once", by: "boss" });
      });

      it("warns on a callback for an approvalId nothing is waiting on", async () => {
        const deps = fakeDeps({
          createCard: vi.fn(async () => ({ cardInstanceId: "inst_1" })),
        });
        const provider = createDingtalkProvider(deps);
        await provider.start(fakeHandle());

        deps.handlers!.onCardCallback({
          params: { approvalId: "appr_ghost", decision: "allowed-once" },
        });
        await flush();

        expect(
          deps.logs.some(
            (line) =>
              line.includes("appr_ghost") && line.includes("nothing is waiting on it"),
          ),
        ).toBe(true);
      });
    });

    it("resolves null when the connect is stopped while the card send is still in flight", async () => {
      let resolveCreate!: (value: { cardInstanceId: string }) => void;
      const createCard = vi.fn(
        () =>
          new Promise<{ cardInstanceId: string }>((resolve) => {
            resolveCreate = resolve;
          }),
      );
      const deps = fakeDeps({ createCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      const pending = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId: "appr_1" }),
      );

      await runtime.stop();
      resolveCreate({ cardInstanceId: "inst_1" });

      await expect(pending).resolves.toBeNull();
    });
  });

  describe("runtime.announceApprovalOutcome", () => {
    /** Requests a card, settles it via a matching callback (allowed-once),
     * and returns once `requestApproval`'s own promise has resolved — so
     * `pendingApprovals` holds a settled-but-not-yet-announced entry the
     * way `announceApprovalOutcome` expects to find it. */
    async function requestAndSettle(
      deps: ReturnType<typeof fakeDeps>,
      runtime: ConnectorRuntime,
      approvalId: string,
    ): Promise<void> {
      const pending = runtime.requestApproval!(
        { key: "cid_1", kind: "p2p" },
        approvalPrompt({ approvalId }),
      );
      await flush();
      deps.handlers!.onCardCallback({ params: { approvalId, decision: "allowed-once" } });
      await pending;
    }

    it("updates the card via deps.updateCard using the stored cardInstanceId", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_42" }));
      const updateCard = vi.fn(async () => undefined);
      const deps = fakeDeps({ createCard, updateCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await requestAndSettle(deps, runtime, "appr_1");

      await runtime.announceApprovalOutcome!(
        { key: "cid_1", kind: "p2p" },
        { approvalId: "appr_1", seq: 1, toolName: "run_shell", outcome: "allowed-once", reason: "answered" },
      );

      expect(updateCard).toHaveBeenCalledWith(validConfig, "inst_42", {
        header: "需要你的审批",
        body: "#1 · run_shell",
        statusLine: "已同意",
      });
    });

    it("is a no-op when the approval was never displayed natively (unknown approvalId)", async () => {
      const updateCard = vi.fn(async () => undefined);
      const deps = fakeDeps({ updateCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await expect(
        runtime.announceApprovalOutcome!(
          { key: "cid_1", kind: "p2p" },
          { approvalId: "never_shown", seq: 1, toolName: "x", outcome: "rejected", reason: "timeout" },
        ),
      ).resolves.toBeUndefined();
      expect(updateCard).not.toHaveBeenCalled();
    });

    it("no-ops without throwing when deps.updateCard is not implemented", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const deps = fakeDeps({ createCard }); // no updateCard
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await requestAndSettle(deps, runtime, "appr_1");

      await expect(
        runtime.announceApprovalOutcome!(
          { key: "cid_1", kind: "p2p" },
          { approvalId: "appr_1", seq: 1, toolName: "run_shell", outcome: "allowed-once", reason: "answered" },
        ),
      ).resolves.toBeUndefined();
    });

    it("logs but does not throw when deps.updateCard rejects", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const updateCard = vi.fn(async () => {
        throw new Error("update_failed");
      });
      const deps = fakeDeps({ createCard, updateCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await requestAndSettle(deps, runtime, "appr_1");

      await expect(
        runtime.announceApprovalOutcome!(
          { key: "cid_1", kind: "p2p" },
          { approvalId: "appr_1", seq: 1, toolName: "run_shell", outcome: "rejected", reason: "answered" },
        ),
      ).resolves.toBeUndefined();
      expect(deps.logs.some((line) => line.includes("update_failed"))).toBe(true);
    });

    it("removes the pending entry after announcing: a later announce for the same id is a no-op", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const updateCard = vi.fn(async () => undefined);
      const deps = fakeDeps({ createCard, updateCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await requestAndSettle(deps, runtime, "appr_1");
      await runtime.announceApprovalOutcome!(
        { key: "cid_1", kind: "p2p" },
        { approvalId: "appr_1", seq: 1, toolName: "run_shell", outcome: "allowed-once", reason: "answered" },
      );
      updateCard.mockClear();

      await runtime.announceApprovalOutcome!(
        { key: "cid_1", kind: "p2p" },
        { approvalId: "appr_1", seq: 1, toolName: "run_shell", outcome: "allowed-once", reason: "answered" },
      );

      expect(updateCard).not.toHaveBeenCalled();
    });

    it("maps the timeout settlement reason to its own status line (已超时拒绝, not the generic 已拒绝)", async () => {
      const createCard = vi.fn(async () => ({ cardInstanceId: "inst_1" }));
      const updateCard = vi.fn(async () => undefined);
      const deps = fakeDeps({ createCard, updateCard });
      const handle = fakeHandle();
      const provider = createDingtalkProvider(deps);
      const runtime = await provider.start(handle);

      await requestAndSettle(deps, runtime, "appr_timeout");
      await runtime.announceApprovalOutcome!(
        { key: "cid_1", kind: "p2p" },
        { approvalId: "appr_timeout", seq: 1, toolName: "x", outcome: "rejected", reason: "timeout" },
      );

      expect(updateCard).toHaveBeenLastCalledWith(
        validConfig,
        "inst_1",
        expect.objectContaining({ statusLine: "已超时拒绝" }),
      );
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

// --- handleCardFrame: same parse+dispatch shape as handleRobotFrame above,
// for the TOPIC_CARD callback topic. -------------------------------------

describe("handleCardFrame", () => {
  it("swallows a malformed JSON frame, logs it, and never calls onCardCallback", () => {
    const onCardCallback = vi.fn();
    const logs: string[] = [];

    expect(() =>
      handleCardFrame("{not valid json", { onCardCallback }, (msg) => logs.push(msg)),
    ).not.toThrow();

    expect(onCardCallback).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("malformed");
  });

  it("calls onCardCallback with the parsed payload for valid JSON", () => {
    const onCardCallback = vi.fn();
    const logs: string[] = [];

    handleCardFrame(
      JSON.stringify({ params: { approvalId: "appr_1", decision: "allowed-once" } }),
      { onCardCallback },
      (msg) => logs.push(msg),
    );

    expect(onCardCallback).toHaveBeenCalledWith({
      params: { approvalId: "appr_1", decision: "allowed-once" },
    });
    expect(logs).toHaveLength(0);
  });

  it("does not throw when the log callback is omitted", () => {
    expect(() => handleCardFrame("{not valid json", { onCardCallback: vi.fn() })).not.toThrow();
  });

  it("swallows and logs when onCardCallback itself throws", () => {
    const onCardCallback = vi.fn(() => {
      throw new Error("handler exploded");
    });
    const logs: string[] = [];

    expect(() =>
      handleCardFrame(JSON.stringify({ params: {} }), { onCardCallback }, (msg) => logs.push(msg)),
    ).not.toThrow();

    expect(logs.some((line) => line.includes("handler exploded"))).toBe(true);
  });
});

// --- realDingtalkDeps.createCard: the one behavior testable without
// mocking `fetch` — a connect with no provisioned card template must fail
// fast, before any network call, so `runtime.requestApproval` degrades to
// `null` (text fallback) rather than attempting a call that could never
// have worked. ------------------------------------------------------------

describe("realDingtalkDeps.createClient", () => {
  it("registers both TOPIC_ROBOT and TOPIC_CARD callback listeners on the real DWClient", () => {
    const registerSpy = vi.spyOn(DWClient.prototype, "registerCallbackListener");

    realDingtalkDeps.createClient(validConfig, { onRobotMessage: vi.fn(), onCardCallback: vi.fn() });

    const topics = registerSpy.mock.calls.map((call) => call[0]);
    expect(topics).toContain(TOPIC_ROBOT);
    expect(topics).toContain(TOPIC_CARD);

    registerSpy.mockRestore();
  });
});

describe("realDingtalkDeps.createCard", () => {
  it("rejects without a network call when approvalCardTemplateId is not configured", async () => {
    const content = buildApprovalCardPrompt({ seq: 1, toolName: "run_shell" });
    await expect(
      realDingtalkDeps.createCard!(
        validConfig, // no approvalCardTemplateId
        "appr_1",
        { conversationKey: "cid_1", conversationKind: "p2p" },
        content,
      ),
    ).rejects.toThrow("dingtalk_approval_card_template_id_missing");
  });
});
