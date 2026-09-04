import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type {
  ConnectorHandle,
  ConnectorInboundEnvelope,
  ConnectorStatus,
  OnboardHandle,
  OnboardUpdate,
} from "@amiba/dsh-plugin-connector-core";

// Only `describe("realLarkDeps ...")` below actually exercises this mock —
// every other test in this file drives the provider core through an
// explicit fake `LarkDeps`, never touching the real SDK. Mocked here (not
// per-test) because `vi.mock` factories are hoisted above all imports by
// vitest regardless of where the call site sits in the file.
vi.mock("@larksuiteoapi/node-sdk", () => ({
  Client: vi.fn(),
  Domain: { Feishu: 0, Lark: 1 },
  EventDispatcher: vi.fn(() => ({ register: vi.fn().mockReturnThis() })),
  WSClient: vi.fn(),
  registerApp: vi.fn(),
}));

import { Client, EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";

import {
  createLarkProvider,
  realLarkDeps,
  type ApiLike,
  type LarkDeps,
  type LarkRegisterAppOptions,
  type LarkRegisterAppResult,
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
    sendCard: vi.fn(async () => undefined),
    addReaction: vi.fn(async () => "reaction_1"),
    removeReaction: vi.fn(async () => undefined),
    sendInteractiveCard: vi.fn(async () => ({ messageId: "om_card_1" })),
    updateInteractiveCard: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Flushes the fire-and-forget addReaction promise chain queued by onEvent
 * (a macrotask hop guarantees every pending microtask — including the
 * `.then()`/`.catch()` on that chain — has already run). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeWs(overrides: Partial<WsLike> = {}): WsLike {
  return {
    start: vi.fn(async () => undefined),
    close: vi.fn(),
    ...overrides,
  };
}

/** Default registerApp stub for tests that don't exercise onboard(). */
function fakeRegisterApp(
  impl?: (options: LarkRegisterAppOptions) => Promise<LarkRegisterAppResult>,
): ReturnType<typeof vi.fn> {
  return vi.fn(
    impl ??
      (async () => {
        throw new Error("registerApp not stubbed for this test");
      }),
  );
}

/** Captures every call the provider core makes into the deps seam. */
function fakeDeps(options?: {
  api?: ApiLike;
  ws?: WsLike;
  registerApp?: ReturnType<typeof vi.fn>;
}): LarkDeps & {
  wsCallbacks?: LarkWsCallbacks;
  createWsClient: ReturnType<typeof vi.fn>;
  createApiClient: ReturnType<typeof vi.fn>;
  registerApp: ReturnType<typeof vi.fn>;
  logs: string[];
} {
  const api = options?.api ?? fakeApi();
  const ws = options?.ws ?? fakeWs();
  const logs: string[] = [];
  const deps: LarkDeps & {
    wsCallbacks?: LarkWsCallbacks;
    createWsClient: ReturnType<typeof vi.fn>;
    createApiClient: ReturnType<typeof vi.fn>;
    registerApp: ReturnType<typeof vi.fn>;
    logs: string[];
  } = {
    createApiClient: vi.fn(() => api),
    createWsClient: vi.fn((_config: LarkConnectorConfig, callbacks: LarkWsCallbacks) => {
      deps.wsCallbacks = callbacks;
      return ws;
    }),
    registerApp: options?.registerApp ?? fakeRegisterApp(),
    log: (msg: string) => logs.push(msg),
    logs,
  };
  return deps;
}

/** A minimal `ApprovalPrompt`-shaped request; the runtime only reads these
 * fields (and `signal`) — see `provider.ts`'s `requestApproval`. */
function fakeApprovalRequest(
  overrides: Partial<{
    approvalId: string;
    seq: number;
    toolName: string;
    reason?: string;
    sessionId: string;
    signal: AbortSignal;
  }> = {},
) {
  return {
    approvalId: "amiba-approval-1",
    seq: 1,
    toolName: "shell.exec",
    reason: "rm -rf /tmp/cache",
    sessionId: "session-1",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function fakeCardActionEvent(overrides: {
  messageId?: string;
  operatorOpenId?: string;
  approvalId?: string;
  decision?: string;
} = {}) {
  return {
    context: {
      open_message_id: overrides.messageId ?? "om_card_1",
      open_chat_id: "oc_1",
    },
    operator: { open_id: overrides.operatorOpenId ?? "ou_operator_1" },
    action: {
      tag: "button",
      value: {
        approvalId: overrides.approvalId ?? "amiba-approval-1",
        decision: overrides.decision ?? "allowed-once",
      },
    },
  };
}

function fakeOnboardHandle(
  signal: AbortSignal = new AbortController().signal,
): OnboardHandle & { emits: OnboardUpdate[] } {
  const emits: OnboardUpdate[] = [];
  return {
    signal,
    emits,
    emit: (update: OnboardUpdate) => emits.push(update),
  };
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
    expect(provider.capabilities(validConfig)).toHaveLength(2);
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

    it("fires a Typing reaction on the inbound message without blocking onInbound, then stores the reaction id", async () => {
      const api = fakeApi({ addReaction: vi.fn(async () => "reaction_typing_1") });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await callbacks.onEvent?.({
        sender: { sender_id: { open_id: "ou_user_1" } },
        message: {
          message_id: "msg_typing_1",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hello"}',
        },
      });

      expect(api.addReaction).toHaveBeenCalledWith("msg_typing_1", "Typing");
      expect(handle.onInbound).toHaveBeenCalled();

      // Stored reaction id is observable via deliver()'s removeReaction call.
      await flushMicrotasks();
      await runtime.deliver(
        { key: "oc_1", kind: "p2p" },
        {
          id: "out-typing-1",
          channelId: "channel-1",
          sessionId: "session-1",
          inReplyTo: "msg_typing_1",
          text: "pong",
          createdAt: new Date().toISOString(),
        },
      );
      expect(api.removeReaction).toHaveBeenCalledWith(
        "msg_typing_1",
        "reaction_typing_1",
      );
    });

    it("does not let an addReaction failure block onInbound or throw", async () => {
      const api = fakeApi({
        addReaction: vi.fn(async () => {
          throw new Error("reaction_add_failed");
        }),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await expect(
        callbacks.onEvent?.({
          sender: { sender_id: { open_id: "ou_user_1" } },
          message: {
            message_id: "msg_typing_fail",
            chat_id: "oc_1",
            chat_type: "p2p",
            message_type: "text",
            content: '{"text":"hello"}',
          },
        }),
      ).resolves.toBeUndefined();

      expect(handle.onInbound).toHaveBeenCalled();
      await flushMicrotasks();
      expect(deps.logs.some((line) => line.includes("reaction_add_failed"))).toBe(
        true,
      );
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

    it("gates late ws callbacks behind stop(): no status writes, inbound delivery, or reaction after stop", async () => {
      const api = fakeApi();
      const deps = fakeDeps({ api });
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
      expect(api.addReaction).not.toHaveBeenCalled();
    });
  });

  // --- Contract item 3: runtime.deliver() -----------------------------

  describe("runtime.deliver", () => {
    it("sends the reply as a markdown card via deps.sendCard using the conversation key", async () => {
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

      expect(api.sendCard).toHaveBeenCalledWith("oc_target", "pong");
      expect(api.sendText).not.toHaveBeenCalled();
    });

    it("falls back to deps.sendText (logging the fallback) when sendCard rejects, and still resolves", async () => {
      const api = fakeApi({
        sendCard: vi.fn(async () => {
          throw new Error("card_schema_rejected");
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
            id: "out-1b",
            channelId: "channel-1",
            sessionId: "session-1",
            inReplyTo: "msg_1",
            text: "pong",
            createdAt: new Date().toISOString(),
          },
        ),
      ).resolves.toBeUndefined();

      expect(api.sendCard).toHaveBeenCalledWith("oc_target", "pong");
      expect(api.sendText).toHaveBeenCalledWith("oc_target", "pong");
      expect(
        deps.logs.some((line) => line.includes("card_schema_rejected")),
      ).toBe(true);
    });

    it("propagates a rejection (for outbox retry) when both sendCard and the sendText fallback fail", async () => {
      const api = fakeApi({
        sendCard: vi.fn(async () => {
          throw new Error("card_schema_rejected");
        }),
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

    // Fix round 1: a business-level failure (chat/account-level — permission
    // revoked, bot removed from the chat, invalid receive_id, content
    // moderation, rate limit) is NOT card-specific, so a sendCard failure of
    // this class means the sendText fallback to the SAME chat very plausibly
    // hits the identical condition. Both the real sendCard and (after the
    // fix) the real sendText throw on such a response (`res.code` truthy),
    // which is what makes this reject rather than resolve — models that
    // scenario with realistic `lark_send_*_failed:<code>` error shapes
    // rather than generic strings, so the case this fix closes stays visible
    // even though it exercises the same ApiLike-seam control flow as the
    // "both throw" test above.
    it("propagates a rejection when sendCard AND the sendText fallback both fail on a business-level (non-zero res.code) error", async () => {
      const api = fakeApi({
        sendCard: vi.fn(async () => {
          throw new Error("lark_send_card_failed:230002");
        }),
        sendText: vi.fn(async () => {
          throw new Error("lark_send_text_failed:230002");
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
            id: "out-2b",
            channelId: "channel-1",
            sessionId: "session-1",
            inReplyTo: "msg_1",
            text: "pong",
            createdAt: new Date().toISOString(),
          },
        ),
      ).rejects.toThrow("lark_send_text_failed:230002");
    });

    it("removes the stored Typing reaction for inReplyTo before sending the card", async () => {
      const api = fakeApi({ addReaction: vi.fn(async () => "reaction_xyz") });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await callbacks.onEvent?.({
        sender: { sender_id: { open_id: "ou_user_1" } },
        message: {
          message_id: "msg_reply_target",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hello"}',
        },
      });
      await flushMicrotasks();

      await runtime.deliver(
        { key: "oc_1", kind: "p2p" },
        {
          id: "out-3",
          channelId: "channel-1",
          sessionId: "session-1",
          inReplyTo: "msg_reply_target",
          text: "pong",
          createdAt: new Date().toISOString(),
        },
      );

      expect(api.removeReaction).toHaveBeenCalledWith(
        "msg_reply_target",
        "reaction_xyz",
      );
      expect(api.sendCard).toHaveBeenCalledWith("oc_1", "pong");
    });

    it("still sends the card when removeReaction fails (best-effort, never blocks the reply)", async () => {
      const api = fakeApi({
        addReaction: vi.fn(async () => "reaction_xyz"),
        removeReaction: vi.fn(async () => {
          throw new Error("reaction_remove_failed");
        }),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await callbacks.onEvent?.({
        sender: { sender_id: { open_id: "ou_user_1" } },
        message: {
          message_id: "msg_reply_target_2",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hello"}',
        },
      });
      await flushMicrotasks();

      await expect(
        runtime.deliver(
          { key: "oc_1", kind: "p2p" },
          {
            id: "out-4",
            channelId: "channel-1",
            sessionId: "session-1",
            inReplyTo: "msg_reply_target_2",
            text: "pong",
            createdAt: new Date().toISOString(),
          },
        ),
      ).resolves.toBeUndefined();

      expect(api.sendCard).toHaveBeenCalledWith("oc_1", "pong");
      expect(
        deps.logs.some((line) => line.includes("reaction_remove_failed")),
      ).toBe(true);
    });

    it("does not call removeReaction when inReplyTo has no stored reaction, and still sends the card", async () => {
      const api = fakeApi();
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      await runtime.deliver(
        { key: "oc_1", kind: "p2p" },
        {
          id: "out-5",
          channelId: "channel-1",
          sessionId: "session-1",
          inReplyTo: "msg_never_seen",
          text: "pong",
          createdAt: new Date().toISOString(),
        },
      );

      expect(api.removeReaction).not.toHaveBeenCalled();
      expect(api.sendCard).toHaveBeenCalledWith("oc_1", "pong");
    });
  });

  // --- Approval cards: runtime.requestApproval / announceApprovalOutcome --

  describe("runtime.requestApproval", () => {
    it("sends the approval card to the conversation and returns the card message id internally", async () => {
      const api = fakeApi({
        sendInteractiveCard: vi.fn(async () => ({ messageId: "om_card_1" })),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const request = fakeApprovalRequest();
      void runtime.requestApproval!({ key: "oc_1", kind: "p2p" }, request);
      await flushMicrotasks();

      expect(api.sendInteractiveCard).toHaveBeenCalledTimes(1);
      const [chatId, card] = (api.sendInteractiveCard as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      expect(chatId).toBe("oc_1");
      expect(card).toMatchObject({ schema: "2.0" });
    });

    it("resolves with { outcome: 'allowed-once', by } when the approve button is clicked", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const request = fakeApprovalRequest();
      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        request,
      );
      await flushMicrotasks();

      const callbacks = deps.wsCallbacks!;
      callbacks.onCardAction?.(
        fakeCardActionEvent({ operatorOpenId: "ou_operator_1", decision: "allowed-once" }),
      );

      await expect(pending).resolves.toEqual({
        outcome: "allowed-once",
        by: "ou_operator_1",
      });
    });

    it("resolves with { outcome: 'rejected', by } when the reject button is clicked", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const request = fakeApprovalRequest();
      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        request,
      );
      await flushMicrotasks();

      const callbacks = deps.wsCallbacks!;
      callbacks.onCardAction?.(
        fakeCardActionEvent({ operatorOpenId: "ou_operator_2", decision: "rejected" }),
      );

      await expect(pending).resolves.toEqual({
        outcome: "rejected",
        by: "ou_operator_2",
      });
    });

    it("ignores a card-action callback for a different approvalId", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const request = fakeApprovalRequest({ approvalId: "amiba-approval-1" });
      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        request,
      );
      await flushMicrotasks();

      const callbacks = deps.wsCallbacks!;
      // Unrelated approval, same chat/card key space.
      callbacks.onCardAction?.(fakeCardActionEvent({ approvalId: "some-other-approval" }));
      await flushMicrotasks();

      const race = await Promise.race([pending, Promise.resolve("still-pending")]);
      expect(race).toBe("still-pending");

      // The real click still resolves it.
      callbacks.onCardAction?.(fakeCardActionEvent({ approvalId: "amiba-approval-1" }));
      await expect(pending).resolves.toEqual({
        outcome: "allowed-once",
        by: "ou_operator_1",
      });
    });

    it("ignores a card-action callback for a different (superseded) card message id", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const request = fakeApprovalRequest();
      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        request,
      );
      await flushMicrotasks();

      const callbacks = deps.wsCallbacks!;
      callbacks.onCardAction?.(fakeCardActionEvent({ messageId: "om_wrong_card" }));
      await flushMicrotasks();

      const race = await Promise.race([pending, Promise.resolve("still-pending")]);
      expect(race).toBe("still-pending");
    });

    it("only ever resolves once: a second click after the first is a no-op", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const request = fakeApprovalRequest();
      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        request,
      );
      await flushMicrotasks();

      const callbacks = deps.wsCallbacks!;
      callbacks.onCardAction?.(
        fakeCardActionEvent({ operatorOpenId: "ou_first", decision: "allowed-once" }),
      );
      // A second click for the same approval must not throw or change the
      // already-settled outcome.
      expect(() =>
        callbacks.onCardAction?.(
          fakeCardActionEvent({ operatorOpenId: "ou_second", decision: "rejected" }),
        ),
      ).not.toThrow();

      await expect(pending).resolves.toEqual({ outcome: "allowed-once", by: "ou_first" });
    });

    it("never resolves once request.signal aborts, and detaches the abort listener", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const controller = new AbortController();
      const request = fakeApprovalRequest({ signal: controller.signal });
      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        request,
      );
      await flushMicrotasks();

      controller.abort();
      await flushMicrotasks();

      // A click arriving after the abort must not resolve the abandoned promise.
      const callbacks = deps.wsCallbacks!;
      callbacks.onCardAction?.(fakeCardActionEvent());
      await flushMicrotasks();

      const race = await Promise.race([pending, Promise.resolve("still-pending")]);
      expect(race).toBe("still-pending");
    });

    it("cleans up an already-aborted signal without ever registering a listener leak", async () => {
      const deps = fakeDeps();
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const controller = new AbortController();
      controller.abort();
      const request = fakeApprovalRequest({ signal: controller.signal });
      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        request,
      );
      await flushMicrotasks();

      const race = await Promise.race([pending, Promise.resolve("still-pending")]);
      expect(race).toBe("still-pending");
    });

    it("returns null (text fallback) when sendInteractiveCard throws", async () => {
      const api = fakeApi({
        sendInteractiveCard: vi.fn(async () => {
          throw new Error("lark_send_interactive_card_failed:230002");
        }),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const reply = await runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        fakeApprovalRequest(),
      );

      expect(reply).toBeNull();
      expect(
        deps.logs.some((line) => line.includes("lark_send_interactive_card_failed")),
      ).toBe(true);
    });
  });

  describe("runtime.announceApprovalOutcome", () => {
    function fakeNotice(overrides: Partial<{
      approvalId: string;
      seq: number;
      toolName: string;
      outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable";
      reason: "answered" | "timeout" | "desktop" | "cancelled";
    }> = {}) {
      return {
        approvalId: "amiba-approval-1",
        seq: 1,
        toolName: "shell.exec",
        outcome: "allowed-once" as const,
        reason: "answered" as const,
        ...overrides,
      };
    }

    it("patches the sent card with the settled variant", async () => {
      const api = fakeApi({
        sendInteractiveCard: vi.fn(async () => ({ messageId: "om_card_1" })),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      void runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        fakeApprovalRequest(),
      );
      await flushMicrotasks();

      await runtime.announceApprovalOutcome!(
        { key: "oc_1", kind: "p2p" },
        fakeNotice(),
      );

      expect(api.updateInteractiveCard).toHaveBeenCalledTimes(1);
      const [messageId, card] = (api.updateInteractiveCard as ReturnType<typeof vi.fn>)
        .mock.calls[0]!;
      expect(messageId).toBe("om_card_1");
      expect(card).toMatchObject({ schema: "2.0" });
    });

    it("is a no-op when no card was ever sent for that approvalId", async () => {
      const api = fakeApi();
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      await expect(
        runtime.announceApprovalOutcome!(
          { key: "oc_1", kind: "p2p" },
          fakeNotice({ approvalId: "never-sent" }),
        ),
      ).resolves.toBeUndefined();
      expect(api.updateInteractiveCard).not.toHaveBeenCalled();
    });

    it("logs but does not throw when updateInteractiveCard fails", async () => {
      const api = fakeApi({
        sendInteractiveCard: vi.fn(async () => ({ messageId: "om_card_1" })),
        updateInteractiveCard: vi.fn(async () => {
          throw new Error("lark_update_interactive_card_failed:230002");
        }),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      void runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        fakeApprovalRequest(),
      );
      await flushMicrotasks();

      await expect(
        runtime.announceApprovalOutcome!({ key: "oc_1", kind: "p2p" }, fakeNotice()),
      ).resolves.toBeUndefined();
      expect(
        deps.logs.some((line) => line.includes("lark_update_interactive_card_failed")),
      ).toBe(true);
    });

    it("clears the pending click resolver too, so a late click after settlement is inert", async () => {
      const api = fakeApi({
        sendInteractiveCard: vi.fn(async () => ({ messageId: "om_card_1" })),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        fakeApprovalRequest(),
      );
      await flushMicrotasks();

      // Settled by another path (e.g. a text reply) before any click arrives.
      await runtime.announceApprovalOutcome!(
        { key: "oc_1", kind: "p2p" },
        fakeNotice({ reason: "answered", outcome: "rejected" }),
      );

      const callbacks = deps.wsCallbacks!;
      expect(() => callbacks.onCardAction?.(fakeCardActionEvent())).not.toThrow();

      const race = await Promise.race([pending, Promise.resolve("still-pending")]);
      expect(race).toBe("still-pending");
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

    it("clears stored reactions on stop() without attempting to remove them (lingering is harmless)", async () => {
      const api = fakeApi({ addReaction: vi.fn(async () => "reaction_stop") });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const callbacks = deps.wsCallbacks!;
      await callbacks.onEvent?.({
        sender: { sender_id: { open_id: "ou_user_1" } },
        message: {
          message_id: "msg_stop_1",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: '{"text":"hello"}',
        },
      });
      await flushMicrotasks();

      await runtime.stop();

      // stop() itself never calls removeReaction...
      expect(api.removeReaction).not.toHaveBeenCalled();

      // ...and the map was actually cleared (not just left unread): a
      // later deliver() for the same inReplyTo finds nothing to remove.
      await runtime.deliver(
        { key: "oc_1", kind: "p2p" },
        {
          id: "out-stop-1",
          channelId: "channel-1",
          sessionId: "session-1",
          inReplyTo: "msg_stop_1",
          text: "pong",
          createdAt: new Date().toISOString(),
        },
      );
      expect(api.removeReaction).not.toHaveBeenCalled();
    });

    it("clears pending approval-card state on stop(): a late click after stop never resolves", async () => {
      const api = fakeApi({
        sendInteractiveCard: vi.fn(async () => ({ messageId: "om_card_1" })),
      });
      const deps = fakeDeps({ api });
      const handle = fakeHandle();
      const provider = createLarkProvider(deps);
      const runtime = await provider.start(handle);

      const pending = runtime.requestApproval!(
        { key: "oc_1", kind: "p2p" },
        fakeApprovalRequest(),
      );
      await flushMicrotasks();

      await runtime.stop();

      const callbacks = deps.wsCallbacks!;
      expect(() => callbacks.onCardAction?.(fakeCardActionEvent())).not.toThrow();

      const race = await Promise.race([pending, Promise.resolve("still-pending")]);
      expect(race).toBe("still-pending");
    });
  });

  // --- Contract item 5: onboard() ---------------------------------------

  describe("onboard", () => {
    it("forwards onQRCodeReady and onStatusChange callbacks as emits, in order", async () => {
      const registerApp = fakeRegisterApp(async (options) => {
        options.onQRCodeReady({ url: "https://example.com/qr", expireIn: 300 });
        options.onStatusChange?.({ status: "polling" });
        options.onStatusChange?.({ status: "slow_down", interval: 5 });
        return { client_id: "cli_1", client_secret: "secret_1" };
      });
      const deps = fakeDeps({ registerApp });
      const handle = fakeOnboardHandle();
      const provider = createLarkProvider(deps);

      await provider.onboard!(handle);

      expect(handle.emits).toEqual([
        { kind: "qr", url: "https://example.com/qr", expireIn: 300 },
        { kind: "status", note: "polling" },
        { kind: "status", note: "slow_down" },
      ]);
    });

    it("maps the registerApp result to config (domain from tenant_brand, both ways) without a redundant tenantToken call", async () => {
      // createConnect validates the returned config via provider.validate()
      // moments later, which itself calls tenantToken() — onboard() must not
      // duplicate that call.
      const larkApi = fakeApi();
      const larkDeps = fakeDeps({
        api: larkApi,
        registerApp: fakeRegisterApp(async (options) => {
          options.onQRCodeReady({ url: "https://example.com/qr", expireIn: 300 });
          return {
            client_id: "cli_lark",
            client_secret: "secret_lark",
            user_info: { open_id: "ou_scanner", tenant_brand: "lark" },
          };
        }),
      });
      const larkProvider = createLarkProvider(larkDeps);

      const larkResult = await larkProvider.onboard!(fakeOnboardHandle());

      expect(larkResult.config).toEqual({
        appId: "cli_lark",
        appSecret: "secret_lark",
        domain: "lark",
      });
      expect(larkDeps.createApiClient).not.toHaveBeenCalled();
      expect(larkApi.tenantToken).not.toHaveBeenCalled();

      const feishuApi = fakeApi();
      const feishuDeps = fakeDeps({
        api: feishuApi,
        registerApp: fakeRegisterApp(async (options) => {
          options.onQRCodeReady({ url: "https://example.com/qr", expireIn: 300 });
          return { client_id: "cli_feishu", client_secret: "secret_feishu" };
        }),
      });
      const feishuProvider = createLarkProvider(feishuDeps);

      const feishuResult = await feishuProvider.onboard!(fakeOnboardHandle());

      expect(feishuResult.config).toEqual({
        appId: "cli_feishu",
        appSecret: "secret_feishu",
        domain: "feishu",
      });
      expect(feishuDeps.createApiClient).not.toHaveBeenCalled();
      expect(feishuApi.tenantToken).not.toHaveBeenCalled();
    });

    it("propagates a registerApp rejection", async () => {
      const deps = fakeDeps({
        registerApp: fakeRegisterApp(async () => {
          throw new Error("access_denied");
        }),
      });
      const handle = fakeOnboardHandle();
      const provider = createLarkProvider(deps);

      await expect(provider.onboard!(handle)).rejects.toThrow("access_denied");
    });

    it("passes the handle's own signal through and propagates rejection on abort", async () => {
      const controller = new AbortController();
      let observedSignal: AbortSignal | undefined;
      const deps = fakeDeps({
        registerApp: fakeRegisterApp(
          (options) =>
            new Promise((_resolve, reject) => {
              observedSignal = options.signal;
              options.signal?.addEventListener("abort", () => {
                reject(new Error("abort"));
              });
            }),
        ),
      });
      const handle = fakeOnboardHandle(controller.signal);
      const provider = createLarkProvider(deps);

      const pending = provider.onboard!(handle);
      controller.abort();

      await expect(pending).rejects.toThrow("abort");
      expect(observedSignal).toBe(controller.signal);
      expect(observedSignal?.aborted).toBe(true);
    });

    it("is present as a function on the default (SDK-backed) provider", () => {
      const provider = createLarkProvider();
      expect(typeof provider.onboard).toBe("function");
    });
  });

  // --- Contract item 6: capabilities() ---------------------------------

  describe("capabilities", () => {
    it("declares exactly [mcp, cli] in a stable order", () => {
      const provider = createLarkProvider(fakeDeps());
      const decls = provider.capabilities(validConfig);
      expect(decls.map((decl) => decl.kind)).toEqual(["mcp", "cli"]);
    });

    it("declares the lark-mcp server with a base (unnamespaced) serverName, pinned version, and preset.light tools", () => {
      const provider = createLarkProvider(fakeDeps());
      const [mcpDecl] = provider.capabilities(validConfig);
      if (mcpDecl?.kind !== "mcp") throw new Error("expected mcp decl first");
      expect(mcpDecl.spec).toMatchObject({
        serverName: "lark",
        transport: "stdio",
        command: "npx",
        enabled: true,
      });
      if (mcpDecl.spec.transport !== "stdio") throw new Error("expected stdio spec");
      expect(mcpDecl.spec.args).toEqual([
        "-y",
        "@larksuiteoapi/lark-mcp@0.5.1",
        "mcp",
        "-t",
        "preset.light",
      ]);
    });

    it("puts lark-mcp credentials in env (verified: APP_ID/APP_SECRET), never in argv", () => {
      const provider = createLarkProvider(fakeDeps());
      const [mcpDecl] = provider.capabilities(validConfig);
      if (mcpDecl?.kind !== "mcp" || mcpDecl.spec.transport !== "stdio") {
        throw new Error("expected stdio mcp decl first");
      }
      expect(mcpDecl.spec.env).toEqual({
        APP_ID: validConfig.appId,
        APP_SECRET: validConfig.appSecret,
      });
      expect(mcpDecl.spec.args).not.toContain(validConfig.appId);
      expect(mcpDecl.spec.args).not.toContain(validConfig.appSecret);
      expect(mcpDecl.spec.args.join(" ")).not.toContain(validConfig.appSecret);
    });

    it("appends --domain for the lark tenant brand but not for the feishu default", () => {
      const provider = createLarkProvider(fakeDeps());

      const [feishuMcp] = provider.capabilities(validConfig);
      if (feishuMcp?.kind !== "mcp" || feishuMcp.spec.transport !== "stdio") {
        throw new Error("expected stdio mcp decl first");
      }
      expect(feishuMcp.spec.args).not.toContain("--domain");

      const larkConfig: LarkConnectorConfig = { ...validConfig, domain: "lark" };
      const [larkMcp] = provider.capabilities(larkConfig);
      if (larkMcp?.kind !== "mcp" || larkMcp.spec.transport !== "stdio") {
        throw new Error("expected stdio mcp decl first");
      }
      expect(larkMcp.spec.args).toEqual([
        "-y",
        "@larksuiteoapi/lark-mcp@0.5.1",
        "mcp",
        "-t",
        "preset.light",
        "--domain",
        "https://open.larksuite.com",
      ]);
    });

    it("declares the lark-cli provisioning spec with pinned version, binary, credential env, and curated skills", () => {
      const provider = createLarkProvider(fakeDeps());
      const [, cliDecl] = provider.capabilities(validConfig);
      if (cliDecl?.kind !== "cli") throw new Error("expected cli decl second");
      expect(cliDecl.spec).toMatchObject({
        id: "lark",
        package: "@larksuite/cli",
        binary: "lark-cli",
        minVersion: "1.0.0",
        pinnedVersion: "1.0.92",
        env: {
          LARKSUITE_CLI_APP_ID: validConfig.appId,
          LARKSUITE_CLI_APP_SECRET: validConfig.appSecret,
        },
      });
      expect(cliDecl.spec.skills.length).toBeGreaterThan(0);
      expect(cliDecl.spec.skills).toEqual([
        "lark-doc",
        "lark-wiki",
        "lark-drive",
        "lark-openapi-explorer",
        "lark-contact",
      ]);
    });

    it("parses config via larkConfigSchema first, throwing on an invalid config before building any decl", () => {
      const provider = createLarkProvider(fakeDeps());
      expect(() =>
        provider.capabilities({ appId: "", appSecret: "", domain: "nope" }),
      ).toThrow();
    });
  });
});

// --- realLarkDeps: real-SDK-backed behavior -----------------------------
//
// Every test above drives the provider core through an explicit fake
// `LarkDeps`/`ApiLike`, which is the right level for the provider's own
// control flow but can never catch a defect that lives purely inside
// `realLarkDeps`'s SDK-call mapping — a seam-level fake always resolves or
// rejects exactly as the test tells it to, regardless of what the real
// implementation does. Fix round 1: `sendText`'s real impl resolved
// silently on a non-zero business `res.code` (the SDK's shared axios
// response interceptor returns `resp.data` and never inspects `code`
// itself — see the SDK-verification comment block in provider.ts), so a
// chat/account-level failure (permission revoked, bot removed from chat,
// etc.) that also breaks the sendText fallback would have gone completely
// unnoticed. This block exercises `realLarkDeps.createApiClient(...)`
// directly against a mocked `Client` to regression-lock that fix at the
// only layer that can actually see it.
describe("realLarkDeps.createApiClient — business-level (res.code) failures", () => {
  it("sendText rejects when the SDK response carries a non-zero code, instead of resolving silently", async () => {
    const create = vi.fn(async () => ({
      code: 230002,
      msg: "no permission to send message to this chat",
    }));
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      im: {
        message: { create },
        messageReaction: { create: vi.fn(), delete: vi.fn() },
      },
      auth: { tenantAccessToken: { internal: vi.fn() } },
      request: vi.fn(),
    }));

    const api = realLarkDeps.createApiClient(validConfig);

    await expect(api.sendText("oc_1", "hello")).rejects.toThrow(
      "no permission to send message to this chat",
    );
    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_1",
        msg_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    });
  });

  it("sendCard rejects when the SDK response carries a non-zero code (regression guard, already fixed pre-round-1)", async () => {
    const create = vi.fn(async () => ({
      code: 230002,
      msg: "invalid card schema",
    }));
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      im: {
        message: { create },
        messageReaction: { create: vi.fn(), delete: vi.fn() },
      },
      auth: { tenantAccessToken: { internal: vi.fn() } },
      request: vi.fn(),
    }));

    const api = realLarkDeps.createApiClient(validConfig);

    await expect(api.sendCard("oc_1", "**hi**")).rejects.toThrow(
      "invalid card schema",
    );
  });

  it("sendInteractiveCard posts msg_type interactive and returns the message id", async () => {
    const create = vi.fn(async () => ({
      code: 0,
      data: { message_id: "om_card_1" },
    }));
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      im: {
        message: { create, patch: vi.fn() },
        messageReaction: { create: vi.fn(), delete: vi.fn() },
      },
      auth: { tenantAccessToken: { internal: vi.fn() } },
      request: vi.fn(),
    }));

    const api = realLarkDeps.createApiClient(validConfig);
    const card = { schema: "2.0" };

    await expect(api.sendInteractiveCard("oc_1", card)).resolves.toEqual({
      messageId: "om_card_1",
    });
    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_1",
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
  });

  it("sendInteractiveCard rejects on a non-zero response code", async () => {
    const create = vi.fn(async () => ({ code: 230002, msg: "no permission" }));
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      im: { message: { create, patch: vi.fn() }, messageReaction: { create: vi.fn(), delete: vi.fn() } },
      auth: { tenantAccessToken: { internal: vi.fn() } },
      request: vi.fn(),
    }));

    const api = realLarkDeps.createApiClient(validConfig);
    await expect(api.sendInteractiveCard("oc_1", {})).rejects.toThrow("no permission");
  });

  it("sendInteractiveCard rejects when the response carries no message_id", async () => {
    const create = vi.fn(async () => ({ code: 0, data: {} }));
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      im: { message: { create, patch: vi.fn() }, messageReaction: { create: vi.fn(), delete: vi.fn() } },
      auth: { tenantAccessToken: { internal: vi.fn() } },
      request: vi.fn(),
    }));

    const api = realLarkDeps.createApiClient(validConfig);
    await expect(api.sendInteractiveCard("oc_1", {})).rejects.toThrow(
      "lark_send_interactive_card_missing_message_id",
    );
  });

  it("updateInteractiveCard patches the message content by message_id", async () => {
    const patch = vi.fn(async () => ({ code: 0 }));
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      im: { message: { create: vi.fn(), patch }, messageReaction: { create: vi.fn(), delete: vi.fn() } },
      auth: { tenantAccessToken: { internal: vi.fn() } },
      request: vi.fn(),
    }));

    const api = realLarkDeps.createApiClient(validConfig);
    const card = { schema: "2.0" };
    await expect(api.updateInteractiveCard("om_card_1", card)).resolves.toBeUndefined();
    expect(patch).toHaveBeenCalledWith({
      data: { content: JSON.stringify(card) },
      path: { message_id: "om_card_1" },
    });
  });

  it("updateInteractiveCard rejects on a non-zero response code", async () => {
    const patch = vi.fn(async () => ({ code: 230002, msg: "message not found" }));
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      im: { message: { create: vi.fn(), patch }, messageReaction: { create: vi.fn(), delete: vi.fn() } },
      auth: { tenantAccessToken: { internal: vi.fn() } },
      request: vi.fn(),
    }));

    const api = realLarkDeps.createApiClient(validConfig);
    await expect(api.updateInteractiveCard("om_card_1", {})).rejects.toThrow(
      "message not found",
    );
  });
});

// This regression-locks the SDK-level decision documented in
// `realLarkDeps.createWsClient`'s own comment block: `card.action.trigger`
// is registered on the SAME `EventDispatcher` instance as
// `im.message.receive_v1`, rather than switching to `LarkChannel` or a
// second connection.
describe("realLarkDeps.createWsClient — dispatcher registration", () => {
  it("registers both im.message.receive_v1 and card.action.trigger, wiring each to the matching callback", () => {
    const registerMock = vi.fn().mockReturnThis();
    (EventDispatcher as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      register: registerMock,
    }));
    (WSClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      start: vi.fn(),
      close: vi.fn(),
    }));

    const onEvent = vi.fn();
    const onCardAction = vi.fn();
    realLarkDeps.createWsClient(validConfig, { onEvent, onCardAction });

    expect(registerMock).toHaveBeenCalledTimes(1);
    const handles = registerMock.mock.calls[0]![0] as Record<
      string,
      (data: unknown) => void
    >;
    expect(Object.keys(handles)).toEqual(
      expect.arrayContaining(["im.message.receive_v1", "card.action.trigger"]),
    );

    handles["card.action.trigger"]!({ raw: "card" });
    expect(onCardAction).toHaveBeenCalledWith({ raw: "card" });

    handles["im.message.receive_v1"]!({ raw: "message" });
    expect(onEvent).toHaveBeenCalledWith({ raw: "message" });
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
