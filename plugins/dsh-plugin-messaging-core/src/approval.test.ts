import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApprovalOutcome,
  ApprovalPrompt,
  ApprovalReply,
  RelayApprovalRequest,
} from "./approval.js";
import { MessageChannelCenter, type MessageChannelProvider } from "./center.js";
import { MessageCenterStore } from "./store.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  // A settled approval can still be flushing its outbox write when the test
  // returns, so retry the teardown rather than racing the store's temp file.
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }),
    ),
  );
});

type Answerer = (
  req: RelayApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>;

/**
 * Fake Cordis context that mirrors the two contracts this relay leans on: the
 * `approval/request` waterfall (listeners run in registration order, each one
 * free to claim or delegate through `next()`) and `ctx.on`'s `prepend`
 * shorthand, which unshifts the listener so it runs BEFORE the ones already
 * registered — how messaging-core outranks the desktop answerer.
 */
async function harness(options: { approvalService?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "amiba-approval-"));
  roots.push(root);
  const followup = vi.fn();
  const live = new Map<string, unknown>();
  const makeAgent = (id: string) => ({
    followup,
    session: { id, header: { id }, events: [] },
    inbox: { nextTurn: [], nextStep: [] },
  });
  const answerers: Answerer[] = [];
  const disposers: Array<() => unknown> = [];
  const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const reflectServices = new Map<string, unknown>();
  if (options.approvalService !== false) reflectServices.set("approval", {});

  const ctx = {
    agents: {
      get: (id: string) => live.get(id),
      create: async ({
        sessionId,
        setup,
      }: {
        sessionId: string;
        setup?: (agentCtx: unknown) => Promise<unknown>;
      }) => {
        if (setup) await setup({});
        const agent = makeAgent(sessionId);
        live.set(sessionId, agent);
        return { agent, dispose: async () => undefined };
      },
      resume: async () => {
        throw new Error("session_not_found");
      },
    },
    agentPresets: { mount: vi.fn(async () => undefined) },
    reflect: { get: (name: string) => reflectServices.get(name) },
    sessionPersistence: {
      inspect: vi.fn(async () => {
        throw new Error("session_not_found");
      }),
    },
    on: (
      name: string,
      callback: Answerer,
      listenerOptions?: boolean | { prepend?: boolean },
    ) => {
      if (name !== "approval/request") return () => true;
      const prepend =
        listenerOptions === true ||
        (typeof listenerOptions === "object" &&
          listenerOptions?.prepend === true);
      if (prepend) answerers.unshift(callback);
      else answerers.push(callback);
      return () => {
        const index = answerers.indexOf(callback);
        if (index >= 0) answerers.splice(index, 1);
        return true;
      };
    },
    effect: (callback: () => unknown) => {
      const cleanup = callback();
      if (typeof cleanup === "function") disposers.push(cleanup as () => unknown);
      return async () => {
        if (typeof cleanup === "function") await (cleanup as () => unknown)();
      };
    },
    logger: () => logger,
  };

  // Stands in for dsh-host-apiproxy's answerer: registered FIRST and claiming
  // unconditionally, so anything messaging-core delegates lands here.
  const desktop = vi.fn<Answerer>(async () => "allowed-once");
  ctx.on("approval/request", desktop);

  const center = new MessageChannelCenter(
    ctx as never,
    new MessageCenterStore(root),
  );

  const dispatch = (req: RelayApprovalRequest): Promise<ApprovalOutcome> => {
    const chain = [...answerers];
    const step = (index: number): Promise<ApprovalOutcome> =>
      index >= chain.length
        ? Promise.resolve<ApprovalOutcome>("unavailable")
        : Promise.resolve(chain[index]!(req, () => step(index + 1)));
    return step(0);
  };

  return {
    root,
    center,
    ctx,
    answerers,
    desktop,
    followup,
    dispatch,
    logger,
    disposers,
    disposeAll: async () => {
      for (const cleanup of disposers.splice(0)) await cleanup();
    },
  };
}

function request(
  sessionId: string,
  overrides: {
    toolName?: string;
    reason?: string;
    callId?: string | null;
    askId?: string | null;
    signal?: AbortSignal;
  } = {},
): RelayApprovalRequest {
  const toolName = overrides.toolName ?? "bash";
  const callId = overrides.callId === undefined ? "call-1" : overrides.callId;
  const askId = overrides.askId === undefined ? "ask-1" : overrides.askId;
  return {
    agent: {
      session: {
        id: sessionId,
        events: askId
          ? [
              {
                type: "approval/asked",
                data: {
                  id: askId,
                  toolName,
                  ...(callId ? { callId } : {}),
                  ...(overrides.reason ? { reason: overrides.reason } : {}),
                },
              },
            ]
          : [],
      },
    },
    toolName,
    ...(overrides.reason ? { reason: overrides.reason } : {}),
    ...(callId ? { callId } : {}),
    ...(overrides.signal ? { signal: overrides.signal } : {}),
  };
}

function imProvider(
  overrides: Partial<MessageChannelProvider> = {},
): MessageChannelProvider & { deliver: ReturnType<typeof vi.fn> } {
  return {
    id: "im",
    name: "IM",
    description: "Fake IM transport",
    supportsInbound: true,
    supportsOutbound: true,
    deliver: vi.fn(async () => undefined),
    ...overrides,
  } as MessageChannelProvider & { deliver: ReturnType<typeof vi.fn> };
}

async function boundChannel(
  center: MessageChannelCenter,
  provider: MessageChannelProvider,
  approval?: { mode: "timeout" | "wait"; timeoutMs: number },
) {
  center.registerProvider(provider);
  const created = await center.createChannel({
    provider: provider.id,
    name: "Ops room",
    agentPreset: "restricted",
    ...(approval ? { approval } : {}),
  });
  const inbound = await center.acceptInbound(created.channel.id, created.secret, {
    id: "evt-seed",
    text: "hello",
    sender: "u-1",
    conversation: { key: "chat-1", kind: "group", title: "Ops" },
  });
  return {
    channelId: created.channel.id,
    secret: created.secret,
    sessionId: inbound.sessionId,
  };
}

describe("IM approval relay", () => {
  it("registers ahead of the desktop answerer and delegates unbound sessions", async () => {
    const { center, answerers, desktop, dispatch } = await harness();
    center.registerProvider(imProvider());
    expect(answerers).toHaveLength(2);
    expect(answerers[0]).not.toBe(desktop);
    expect(answerers[1]).toBe(desktop);

    await expect(dispatch(request("session-unbound"))).resolves.toBe(
      "allowed-once",
    );
    expect(desktop).toHaveBeenCalledTimes(1);
  });

  it("skips registration when no approval service is mounted", async () => {
    const { answerers } = await harness({ approvalService: false });
    expect(answerers).toHaveLength(1);
  });

  it("routes a bound session to the provider's native approval surface", async () => {
    const { center, desktop, dispatch } = await harness();
    const requestApproval = vi.fn<
      NonNullable<MessageChannelProvider["requestApproval"]>
    >(async (): Promise<ApprovalReply> => ({ outcome: "allowed-once", by: "u-1" }));
    const announceApprovalOutcome = vi.fn<
      NonNullable<MessageChannelProvider["announceApprovalOutcome"]>
    >(async () => undefined);
    const provider = imProvider({ requestApproval, announceApprovalOutcome });
    const { sessionId } = await boundChannel(center, provider);

    await expect(dispatch(request(sessionId, { reason: "runs git push" }))).resolves.toBe(
      "allowed-once",
    );
    expect(desktop).not.toHaveBeenCalled();
    expect(provider.deliver).not.toHaveBeenCalled();
    const prompt = requestApproval.mock.calls[0]?.[2] as unknown as ApprovalPrompt;
    expect(prompt).toMatchObject({
      approvalId: "ask-1",
      seq: 1,
      toolName: "bash",
      reason: "runs git push",
      sessionId,
    });
    expect(requestApproval.mock.calls[0]?.[1]).toMatchObject({
      key: "chat-1",
      kind: "group",
    });
    expect(announceApprovalOutcome).toHaveBeenCalledTimes(1);
    expect(announceApprovalOutcome.mock.calls[0]?.[2]).toMatchObject({
      approvalId: "ask-1",
      outcome: "allowed-once",
      reason: "answered",
    });
  });

  it("falls back to a numbered text prompt when the provider cannot present natively", async () => {
    const { center, dispatch } = await harness();
    const provider = imProvider({
      requestApproval: vi.fn<NonNullable<MessageChannelProvider["requestApproval"]>>(
        async () => null,
      ),
    });
    const { sessionId, channelId, secret } = await boundChannel(center, provider);

    const pendingOutcome = dispatch(request(sessionId, { reason: "runs git push" }));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalled());
    const envelope = provider.deliver.mock.calls[0]?.[1] as { text: string };
    expect(envelope.text).toContain("需要审批 #1");
    expect(envelope.text).toContain("bash");
    expect(envelope.text).toContain("runs git push");

    const consumed = await center.acceptInbound(channelId, secret, {
      id: "evt-answer",
      text: "同意 #1",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    expect(consumed).toMatchObject({ consumedAsApproval: true });
    await expect(pendingOutcome).resolves.toBe("allowed-once");
  });

  it("delegates to the desktop when the channel cannot deliver the fallback", async () => {
    const { center, desktop, dispatch } = await harness();
    const provider = imProvider({ supportsOutbound: false, deliver: undefined });
    const { sessionId } = await boundChannel(center, provider as never);
    await expect(dispatch(request(sessionId))).resolves.toBe("allowed-once");
    expect(desktop).toHaveBeenCalledTimes(1);
  });
});

/**
 * Fake timers cover only `setTimeout`/`clearTimeout` here: the relay's own
 * deadline is the single thing under test, while `setImmediate` and `Date`
 * stay real so the store's file I/O still completes between assertions.
 */
function useDeadlineTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

async function flushIo(rounds = 40): Promise<void> {
  for (let index = 0; index < rounds; index += 1)
    await new Promise((resolve) => setImmediate(resolve));
}

/** `vi.waitFor` is off-limits while `setTimeout` is faked — poll the real
 * event loop instead so the store's file I/O can drain. */
async function until(
  predicate: () => boolean,
  rounds = 400,
): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was never met");
}

function deliveredTexts(provider: { deliver: ReturnType<typeof vi.fn> }): string[] {
  return provider.deliver.mock.calls.map(
    (call) => (call[1] as { text: string }).text,
  );
}

describe("IM approval text protocol", () => {
  it("numbers concurrent questions and answers the oldest one when none is named", async () => {
    const { center, dispatch } = await harness();
    const provider = imProvider();
    const { sessionId, channelId, secret } = await boundChannel(center, provider);

    const first = dispatch(request(sessionId, { askId: "ask-1", callId: "call-1" }));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));
    const second = dispatch(
      request(sessionId, { askId: "ask-2", callId: "call-2", toolName: "write" }),
    );
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(2));
    expect(deliveredTexts(provider)[1]).toContain("需要审批 #2");

    await center.acceptInbound(channelId, secret, {
      id: "evt-a",
      text: "  同意  ",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    await expect(first).resolves.toBe("allowed-once");

    await center.acceptInbound(channelId, secret, {
      id: "evt-b",
      text: "拒绝 #2",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    await expect(second).resolves.toBe("rejected");

    // Nothing pending any more: the short numbers restart at #1.
    const third = dispatch(request(sessionId, { askId: "ask-3", callId: "call-3" }));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(3));
    expect(deliveredTexts(provider)[2]).toContain("需要审批 #1");
    await center.acceptInbound(channelId, secret, {
      id: "evt-c",
      text: "no",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    await expect(third).resolves.toBe("rejected");
  });

  it.each([
    ["yes", "allowed-once"],
    ["OK", "allowed-once"],
    ["approve #1", "allowed-once"],
    ["no", "rejected"],
    ["Reject", "rejected"],
    ["拒绝#1", "rejected"],
  ])("accepts %s as an approval answer", async (text, expected) => {
    const { center, dispatch } = await harness();
    const provider = imProvider();
    const { sessionId, channelId, secret } = await boundChannel(center, provider);
    const outcome = dispatch(request(sessionId));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));
    const consumed = await center.acceptInbound(channelId, secret, {
      id: "evt-answer",
      text,
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    expect(consumed.consumedAsApproval).toBe(true);
    await expect(outcome).resolves.toBe(expected);
  });

  it("forwards anything the protocol cannot claim as an ordinary user message", async () => {
    const { center, dispatch, followup } = await harness();
    const provider = imProvider();
    const { sessionId, channelId, secret } = await boundChannel(center, provider);
    const outcome = dispatch(request(sessionId));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));
    followup.mockClear();

    for (const text of ["同意这个方案吧", "yes please", "#1"]) {
      const result = await center.acceptInbound(channelId, secret, {
        id: `evt-${text}`,
        text,
        sender: "u-1",
        conversation: { key: "chat-1", kind: "group" },
      });
      expect(result.consumedAsApproval).toBeUndefined();
    }
    expect(followup).toHaveBeenCalledTimes(3);

    // A number nobody is waiting on is a normal message too, not a silent drop.
    const stray = await center.acceptInbound(channelId, secret, {
      id: "evt-stray",
      text: "同意 #7",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    expect(stray.consumedAsApproval).toBeUndefined();
    expect(followup).toHaveBeenCalledTimes(4);

    await center.acceptInbound(channelId, secret, {
      id: "evt-yes",
      text: "同意",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    await expect(outcome).resolves.toBe("allowed-once");
  });

  it("ignores an answer from a sender the channel does not allow", async () => {
    const { center, dispatch } = await harness();
    const provider = imProvider();
    center.registerProvider(provider);
    const created = await center.createChannel({
      provider: "im",
      name: "Ops room",
      agentPreset: "restricted",
      allowedSenders: ["u-1"],
    });
    const seeded = await center.acceptInbound(created.channel.id, created.secret, {
      id: "evt-seed",
      text: "hello",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    const outcome = dispatch(request(seeded.sessionId));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));

    await expect(
      center.acceptInbound(created.channel.id, created.secret, {
        id: "evt-intruder",
        text: "同意 #1",
        sender: "intruder",
        conversation: { key: "chat-1", kind: "p2p" },
      }),
    ).rejects.toThrow("sender_not_allowed");

    await center.acceptInbound(created.channel.id, created.secret, {
      id: "evt-owner",
      text: "拒绝 #1",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "p2p" },
    });
    await expect(outcome).resolves.toBe("rejected");
  });

  it("keeps the first answer and ignores later ones", async () => {
    const { center, dispatch, followup } = await harness();
    const provider = imProvider();
    const { sessionId, channelId, secret } = await boundChannel(center, provider);
    const outcome = dispatch(request(sessionId));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));
    followup.mockClear();

    await center.acceptInbound(channelId, secret, {
      id: "evt-first",
      text: "同意 #1",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    const late = await center.acceptInbound(channelId, secret, {
      id: "evt-late",
      text: "拒绝 #1",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    expect(late.consumedAsApproval).toBeUndefined();
    await expect(outcome).resolves.toBe("allowed-once");
    // An answer nobody is waiting on is never dropped silently — it reaches
    // the model as the ordinary message it now is.
    expect(followup).toHaveBeenCalledTimes(1);

    // A consumed answer still claims its receipt, so a transport that
    // redelivers it does not turn yesterday's "同意" into a user turn.
    const resent = await center.acceptInbound(channelId, secret, {
      id: "evt-first",
      text: "同意 #1",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    expect(resent).toMatchObject({ accepted: true, duplicate: true });
    expect(followup).toHaveBeenCalledTimes(1);
  });
});

describe("IM approval settlement", () => {
  it("rejects and reports the timeout under the default policy", async () => {
    useDeadlineTimers();
    const { center, dispatch } = await harness();
    const provider = imProvider();
    const { sessionId } = await boundChannel(center, provider);
    const outcome = dispatch(request(sessionId));
    await until(() => provider.deliver.mock.calls.length === 1);

    vi.advanceTimersByTime(600_000);
    await expect(outcome).resolves.toBe("rejected");
    await until(() => provider.deliver.mock.calls.length === 2);
    expect(deliveredTexts(provider)[1]).toContain("已超时拒绝");
    await flushIo();
  });

  it("never times out under the wait policy", async () => {
    useDeadlineTimers();
    const { center, dispatch } = await harness();
    const provider = imProvider();
    const { sessionId, channelId, secret } = await boundChannel(center, provider, {
      mode: "wait",
      timeoutMs: 600_000,
    });
    const outcome = dispatch(request(sessionId));
    await until(() => provider.deliver.mock.calls.length === 1);
    let resolved = false;
    void outcome.then(() => {
      resolved = true;
    });

    vi.advanceTimersByTime(24 * 60 * 60_000);
    await flushIo();
    expect(resolved).toBe(false);

    vi.useRealTimers();
    await center.acceptInbound(channelId, secret, {
      id: "evt-answer",
      text: "同意",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    await expect(outcome).resolves.toBe("allowed-once");
  });

  it("settles cancelled when the asking turn is withdrawn", async () => {
    const { center, dispatch } = await harness();
    const provider = imProvider();
    const { sessionId } = await boundChannel(center, provider);
    const controller = new AbortController();
    const outcome = dispatch(request(sessionId, { signal: controller.signal }));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(outcome).resolves.toBe("cancelled");
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(2));
    expect(deliveredTexts(provider)[1]).toContain("已取消");
  });

  it("delegates an already-withdrawn request instead of claiming it", async () => {
    const { center, desktop, dispatch } = await harness();
    const provider = imProvider();
    const { sessionId } = await boundChannel(center, provider);
    const controller = new AbortController();
    controller.abort();
    await expect(
      dispatch(request(sessionId, { signal: controller.signal })),
    ).resolves.toBe("allowed-once");
    expect(desktop).toHaveBeenCalledTimes(1);
    expect(provider.deliver).not.toHaveBeenCalled();
  });

  it("cancels everything still in flight when the plugin unloads", async () => {
    const { center, dispatch, disposeAll } = await harness();
    const provider = imProvider();
    const { sessionId } = await boundChannel(center, provider);
    const outcome = dispatch(request(sessionId));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));

    await disposeAll();
    await expect(outcome).resolves.toBe("cancelled");
    // Teardown posts nothing: the transport is going away with the plugin.
    expect(provider.deliver).toHaveBeenCalledTimes(1);
  });

  it("falls back to text when the native surface throws, and still announces once", async () => {
    const { center, dispatch } = await harness();
    const announceApprovalOutcome = vi.fn<
      NonNullable<MessageChannelProvider["announceApprovalOutcome"]>
    >(async () => undefined);
    const provider = imProvider({
      requestApproval: vi.fn<NonNullable<MessageChannelProvider["requestApproval"]>>(
        async () => {
          throw new Error("card API 500");
        },
      ),
      announceApprovalOutcome,
    });
    const { sessionId, channelId, secret } = await boundChannel(center, provider);
    const outcome = dispatch(request(sessionId));
    await vi.waitFor(() => expect(provider.deliver).toHaveBeenCalledTimes(1));
    expect(deliveredTexts(provider)[0]).toContain("需要审批 #1");

    await center.acceptInbound(channelId, secret, {
      id: "evt-answer",
      text: "同意",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    await expect(outcome).resolves.toBe("allowed-once");
    // The card never went out, so the card update must not either.
    expect(announceApprovalOutcome).not.toHaveBeenCalled();
  });

  it("lets a text answer beat a native surface that is still waiting", async () => {
    const { center, dispatch } = await harness();
    let abortedByRelay = false;
    const provider = imProvider({
      requestApproval: vi.fn<NonNullable<MessageChannelProvider["requestApproval"]>>(
        (_channel, _conversation, prompt) =>
          new Promise((resolve) => {
            prompt.signal.addEventListener("abort", () => {
              abortedByRelay = true;
              resolve(null);
            });
          }),
      ),
      announceApprovalOutcome: vi.fn<
        NonNullable<MessageChannelProvider["announceApprovalOutcome"]>
      >(async () => undefined),
    });
    const { sessionId, channelId, secret } = await boundChannel(center, provider);
    const outcome = dispatch(request(sessionId));
    await vi.waitFor(() => expect(provider.requestApproval).toHaveBeenCalled());

    await center.acceptInbound(channelId, secret, {
      id: "evt-answer",
      text: "拒绝",
      sender: "u-1",
      conversation: { key: "chat-1", kind: "group" },
    });
    await expect(outcome).resolves.toBe("rejected");
    expect(abortedByRelay).toBe(true);
    expect(provider.announceApprovalOutcome).toHaveBeenCalledTimes(1);
    expect(provider.deliver).not.toHaveBeenCalled();
  });
});
