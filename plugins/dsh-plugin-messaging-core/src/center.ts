import type { Agent } from "@deepseek-ai/dsh-agent";
import {
  createUserMessage,
  freezeMessage,
  type UserMessage,
} from "@deepseek-ai/dsh-llm";
import type { Context } from "@deepseek-ai/cordis";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  ApprovalRelay,
  type ApprovalOutcomeNotice,
  type ApprovalPrompt,
  type ApprovalReply,
} from "./approval.js";
import {
  hashChannelSecret,
  MessageCenterStore,
  MIN_APPROVAL_TIMEOUT_MS,
  resolveChannelApproval,
  type MessageChannelApproval,
  type MessageChannelDeliveryStatus,
  type StoredConversationBinding,
  type StoredMessageChannel,
  type StoredOutboundDelivery,
  type StoredPendingInbound,
} from "./store.js";

export interface MessageChannelView {
  id: string;
  provider: string;
  name: string;
  sessionId: string;
  enabled: boolean;
  outboundUrl?: string;
  allowedSenders: string[];
  agentPreset?: string;
  /** Always present in the view: older rows read back the default policy. */
  approval: MessageChannelApproval;
  createdAt: string;
  updatedAt: string;
  delivery: MessageChannelDeliveryStatus;
}

export interface MessageChannelProviderView {
  id: string;
  name: string;
  description: string;
  supportsInbound: boolean;
  supportsOutbound: boolean;
  inboundPath?: string;
}

export interface MessageChannelProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly supportsInbound: boolean;
  readonly supportsOutbound: boolean;
  readonly inboundPath?: string;
  validate?(channel: StoredMessageChannel): void | Promise<void>;
  deliver?(
    channel: StoredMessageChannel,
    envelope: OutboundMessageEnvelope,
  ): Promise<void>;
  /**
   * Present one tool-approval question on the provider's own surface (a Lark
   * interactive card, a DingTalk AI card…) and resolve with the human's
   * answer. Resolve `null` — never throw for it — when this particular
   * question cannot be presented natively; messaging-core then falls back to
   * its text protocol on the same channel. A throw is treated the same way,
   * with a warning. The prompt's `signal` aborts when the question is settled
   * by any other path, so a native surface can stop waiting.
   */
  requestApproval?(
    channel: StoredMessageChannel,
    conversation: InboundConversationRef,
    request: ApprovalPrompt,
  ): Promise<ApprovalReply | null>;
  /**
   * Called after a natively presented question settles — whoever won — so the
   * card can flip to its result state. Providers without a native surface can
   * omit it: messaging-core posts a text notice instead.
   */
  announceApprovalOutcome?(
    channel: StoredMessageChannel,
    conversation: InboundConversationRef,
    notice: ApprovalOutcomeNotice,
  ): Promise<void>;
}

export interface InboundConversationRef {
  key: string;
  kind: "p2p" | "group";
  title?: string;
}

export interface InboundMessageEnvelope {
  id: string;
  text: string;
  sender?: string;
  metadata?: Record<string, unknown>;
  conversation?: InboundConversationRef;
}

export interface OutboundMessageEnvelope {
  id: string;
  channelId: string;
  sessionId: string;
  inReplyTo: string;
  text: string;
  createdAt: string;
}

function view(
  channel: StoredMessageChannel,
  delivery: MessageChannelDeliveryStatus = {
    pendingInbound: 0,
    queuedOutbound: 0,
    failedOutbound: 0,
  },
): MessageChannelView {
  const { secretHash: _secretHash, ...safe } = channel;
  return { ...safe, approval: resolveChannelApproval(channel), delivery };
}

/**
 * Guard the channel's approval policy at the seam that writes it. `wait` keeps
 * `timeoutMs` (the wizard's last chosen value) but never applies it; `timeout`
 * needs a window long enough for a human to notice a message.
 */
function assertApproval(
  approval: MessageChannelApproval | null | undefined,
): void {
  if (approval === undefined || approval === null) return;
  if (approval.mode !== "timeout" && approval.mode !== "wait")
    throw new Error("invalid_channel_approval");
  if (!Number.isSafeInteger(approval.timeoutMs) || approval.timeoutMs <= 0)
    throw new Error("invalid_channel_approval");
  if (approval.mode === "timeout" && approval.timeoutMs < MIN_APPROVAL_TIMEOUT_MS)
    throw new Error("invalid_channel_approval");
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const row = block as Record<string, unknown>;
      return row.type === "text" && typeof row.text === "string"
        ? [row.text]
        : [];
    })
    .join("\n");
}

function constantTimeSecretMatches(
  actual: string,
  expectedHash: string,
): boolean {
  const actualHash = Buffer.from(hashChannelSecret(actual), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actualHash.length === expected.length &&
    timingSafeEqual(actualHash, expected)
  );
}

interface MessageRuntimeContext extends Context {
  agentPresets: {
    mount(agentCtx: Context, id?: string): Promise<unknown>;
  };
  sessionPersistence: {
    inspect(id: string): Promise<{
      meta: { agentPreset?: string };
      events: readonly SessionEvent[];
    }>;
  };
}

/** Shape of the `agentDefaultModel` service published by dsh-host-apiproxy
 * (and mirrored by any host that seeds agent sessions). It is read through
 * `ctx.reflect.get`, never declared in `inject`: messaging-core has no
 * business depending on it, and Cordis throws on ACCESSING an undeclared
 * injected property (before optional-chaining can even yield undefined), so
 * `ctx.agentDefaultModel?.currentSelection?.()` is unsafe — `reflect.get` is
 * the point-in-time, non-throwing read for an optional service, same as
 * connector-core's `amibaMcpManager` lookup. */
type AgentDefaultModelService = {
  currentSelection(): {
    provider: string;
    model: string;
    reasoningEffort?: unknown;
  };
};

function presetForSession(session: {
  meta: { agentPreset?: string };
  events: readonly SessionEvent[];
}): string | undefined {
  let preset = session.meta.agentPreset;
  for (const event of session.events) {
    const row = event as unknown as {
      type: string;
      data: Record<string, unknown>;
    };
    if (row.type !== "agent-preset/selected") continue;
    const value = row.data.agentPreset;
    if (typeof value === "string" && value.trim()) preset = value.trim();
  }
  return preset;
}

function restoredMessage(pending: StoredPendingInbound): UserMessage {
  return freezeMessage({
    id: pending.dshMessageId as UserMessage["id"],
    role: "user",
    content: [{ type: "text", text: pending.text }],
    source: {
      kind: "plugin",
      plugin: `amiba-message:${pending.channelId}`,
      form: "relay",
    },
  });
}

function eventMessageId(event: SessionEvent): string | undefined {
  if (event.type === "user/message") {
    const id = (event.data as unknown as Record<string, unknown>).id;
    return typeof id === "string" ? id : undefined;
  }
  if (event.type !== "assistant/message") return undefined;
  const message = (event.data as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return undefined;
  const id = (message as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

/**
 * `turn/end`'s `reason` is a structured DSH value (e.g.
 * `{kind:"error", error:{message,code}}` or `{kind:"aborted", reason}`), not a
 * string — interpolating it directly collapses to `[object Object]`. Surface
 * whatever readable detail it carries instead.
 */
function describeTurnEndReason(reason: unknown): string {
  if (reason && typeof reason === "object") {
    const row = reason as Record<string, unknown>;
    if (typeof row.kind === "string") {
      const error = row.error;
      const message =
        error && typeof error === "object"
          ? (error as Record<string, unknown>).message
          : undefined;
      return typeof message === "string" && message.trim()
        ? `${row.kind}: ${message}`
        : row.kind;
    }
    try {
      return JSON.stringify(reason);
    } catch {
      return String(reason);
    }
  }
  return String(reason ?? "completed");
}

function completedTurnReply(
  events: readonly SessionEvent[],
  pending: StoredPendingInbound,
): { messageId: string; text: string; time: number } | null {
  const inputIndex = events.findIndex(
    (event) =>
      event.type === "user/message" &&
      eventMessageId(event) === pending.dshMessageId,
  );
  if (inputIndex < 0) return null;
  let turn: number | undefined;
  for (let index = inputIndex; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "turn/start") continue;
    const value = (event.data as Record<string, unknown>).turn;
    if (typeof value === "number") turn = value;
    break;
  }
  if (turn === undefined) return null;
  const endIndex = events.findIndex(
    (event, index) =>
      index > inputIndex &&
      event.type === "turn/end" &&
      (event.data as Record<string, unknown>).turn === turn,
  );
  if (endIndex < 0) return null;
  const assistantEvents = events
    .slice(inputIndex + 1, endIndex + 1)
    .filter(
      (event) =>
        event.type === "assistant/message" &&
        (event.data as Record<string, unknown>).turn === turn,
    );
  const text = assistantEvents
    .map((event) => {
      const message = (event.data as Record<string, unknown>).message;
      return message && typeof message === "object"
        ? contentText((message as Record<string, unknown>).content)
        : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const end = events[endIndex]!;
  const reason = (end.data as Record<string, unknown>).reason;
  const finalMessage = [...assistantEvents]
    .reverse()
    .find((event) => eventMessageId(event));
  return {
    messageId: finalMessage
      ? eventMessageId(finalMessage)!
      : `${pending.sessionId}:turn:${turn}`,
    text:
      text ||
      `DSH completed the message without a text reply (${describeTurnEndReason(reason)}).`,
    time: end.time,
  };
}

const DELIVERY_MAX_ATTEMPTS = 8;
const RECOVERY_INTERVAL_MS = 5_000;

declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaMessageCenter: MessageChannelCenter;
  }
}

/**
 * DSH-native message hub. Transport plugins register providers here; the hub
 * owns authentication, channel→session routing, deduplication and reply
 * correlation so individual transports never manipulate Agent state directly.
 */
export class MessageChannelCenter {
  private readonly providers = new Map<string, MessageChannelProvider>();
  private readonly resumes = new Map<string, Promise<Agent>>();
  private readonly conversationCreates = new Map<string, Promise<string>>();
  private readonly channelCreates = new Map<string, Promise<string>>();
  private recovery: Promise<void> | null = null;
  private deliveryPump: Promise<void> | null = null;
  private started = false;
  /** Answers DSH tool approvals for sessions bound to an IM conversation. */
  readonly approvals: ApprovalRelay;

  constructor(
    private readonly ctx: Context,
    readonly store: MessageCenterStore,
  ) {
    this.approvals = new ApprovalRelay(ctx, {
      store,
      providerFor: (channel) => this.providers.get(channel.provider),
      queueOutbound: async (envelope) => {
        await this.store.queueOutbound(envelope);
        void this.pumpDeliveries();
      },
      cancelOutbound: (envelopeId) => this.store.markDelivered(envelopeId),
      warn: (message) =>
        this.ctx.logger("amiba-messaging-core").warn(message),
    });
    this.approvals.register();
    ctx.on("session/event", (session, event) => {
      if (event.type === "turn/end") {
        void this.reconcileSession(session).catch((error) => {
          this.ctx
            .logger("amiba-messaging-core")
            .error(
              `Failed to reconcile a completed message turn: ${String(error)}`,
            );
        });
      }
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.ctx.effect(() => {
      const timer = setInterval(() => {
        void this.recoverPending();
        void this.pumpDeliveries();
      }, RECOVERY_INTERVAL_MS);
      timer.unref?.();
      return () => clearInterval(timer);
    }, "amiba-messaging-core.recovery");
    await this.recoverPending();
    await this.pumpDeliveries();
  }

  registerProvider(provider: MessageChannelProvider): () => void {
    if (!/^[a-z][a-z0-9-]*$/u.test(provider.id))
      throw new Error("invalid_channel_provider_id");
    if (this.providers.has(provider.id))
      throw new Error(`duplicate channel provider ${provider.id}`);
    this.providers.set(provider.id, provider);
    void this.pumpDeliveries();
    return () => {
      if (this.providers.get(provider.id) === provider)
        this.providers.delete(provider.id);
    };
  }

  listProviders(): MessageChannelProviderView[] {
    return [...this.providers.values()]
      .map(({ id, name, description, supportsInbound, supportsOutbound, inboundPath }) => ({
        id,
        name,
        description,
        supportsInbound,
        supportsOutbound,
        ...(inboundPath ? { inboundPath } : {}),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listChannels(): Promise<MessageChannelView[]> {
    const [channels, statuses] = await Promise.all([
      this.store.list(),
      this.store.deliveryStatus(),
    ]);
    return channels.map((channel) => view(channel, statuses.get(channel.id)));
  }

  async createChannel(input: {
    provider: string;
    name: string;
    sessionId?: string;
    agentPreset?: string;
    outboundUrl?: string;
    allowedSenders?: string[];
    approval?: MessageChannelApproval;
  }): Promise<{ channel: MessageChannelView; secret: string }> {
    const provider = this.providers.get(input.provider);
    if (!provider) throw new Error("provider_not_found");
    if (!input.name.trim()) throw new Error("invalid_channel");
    if (!input.sessionId?.trim() && !input.agentPreset?.trim())
      throw new Error("invalid_channel");
    assertApproval(input.approval);
    const result = await this.store.create(input);
    try {
      await provider.validate?.(result.channel);
    } catch (error) {
      await this.store.remove(result.channel.id);
      throw error;
    }
    return { channel: view(result.channel), secret: result.secret };
  }

  async updateChannel(
    id: string,
    patch: Parameters<MessageCenterStore["update"]>[1],
  ): Promise<MessageChannelView> {
    const previous = (await this.store.list()).find((item) => item.id === id);
    if (!previous) throw new Error("channel_not_found");
    assertApproval(patch.approval);
    const channel = await this.store.update(id, patch);
    const provider = this.providers.get(channel.provider);
    if (!provider) throw new Error("provider_not_found");
    try {
      await provider.validate?.(channel);
    } catch (error) {
      await this.store.update(id, {
        name: previous.name,
        sessionId: previous.sessionId,
        enabled: previous.enabled,
        outboundUrl: previous.outboundUrl ?? "",
        allowedSenders: previous.allowedSenders,
        // `null` clears the field: a row that had no policy of its own must
        // roll back to having none (and so read as the default), not keep the
        // rejected patch's value.
        approval: previous.approval ?? null,
      });
      throw error;
    }
    const status = (await this.store.deliveryStatus()).get(channel.id);
    if (channel.enabled) void this.pumpDeliveries();
    return view(channel, status);
  }

  removeChannel(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  async rotateSecret(
    id: string,
  ): Promise<{ channel: MessageChannelView; secret: string }> {
    const result = await this.store.rotate(id);
    const status = (await this.store.deliveryStatus()).get(result.channel.id);
    return { channel: view(result.channel, status), secret: result.secret };
  }

  listConversations(channelId?: string): Promise<StoredConversationBinding[]> {
    return this.store.listConversations(channelId);
  }

  unbindConversation(
    channelId: string,
    conversationKey: string,
  ): Promise<boolean> {
    return this.store.removeConversation(channelId, conversationKey);
  }

  async conversationForSession(
    channelId: string,
    sessionId: string,
  ): Promise<StoredConversationBinding | undefined> {
    const binding = await this.store.findConversationBySession(sessionId);
    return binding && binding.channelId === channelId ? binding : undefined;
  }

  /** The seed model each create/resume declares; re-read so it never goes
   * stale. Undefined on headless runtimes that never mount
   * `agentDefaultModel` — callers must tolerate its absence. Read via
   * `ctx.reflect.get`, not a direct property access: messaging-core doesn't
   * (and shouldn't) declare `agentDefaultModel` in `inject`, and Cordis
   * throws `cannot get property "agentDefaultModel" without inject` on the
   * bare access itself for an undeclared injected property — before
   * optional-chaining ever gets a chance to short-circuit. `reflect.get` is
   * a point-in-time read that returns `undefined` for an absent/un-injected
   * service instead of throwing. */
  private defaultAgentOptions(): { provider: string; model: string } | undefined {
    const service = this.ctx.reflect?.get?.("agentDefaultModel") as
      | AgentDefaultModelService
      | undefined;
    const selection = service?.currentSelection?.();
    return selection
      ? { provider: selection.provider, model: selection.model }
      : undefined;
  }

  /**
   * The optional `ctx.workspaceRegistry` service (`@deepseek-ai/dsh-workspace`):
   * the DSH-wide, durable set of archived session ids. "Archived = closed" is
   * the rule across every Amiba plugin — DSH's archive is a grouping-surface
   * fact only, and the kernel still lets anyone resume and prompt an archived
   * session — so messaging-core treats a channel or conversation still bound
   * to one as needing a fresh session, same as `defaultAgentOptions` above:
   * read via `ctx.reflect.get` (a non-throwing, point-in-time lookup), never
   * declared in `inject` (this cordis version's array-form `inject` has no
   * optional flag — see the identical note on dsh-plugin-steward's and
   * dsh-plugin-connector-core's own `inject`), so absence — headless
   * runtimes, this plugin's own tests — simply means nothing is archived.
   */
  private workspaceRegistry(): { readonly archivedSessionIds: readonly string[] } | undefined {
    return this.ctx.reflect?.get?.("workspaceRegistry") as
      | { readonly archivedSessionIds: readonly string[] }
      | undefined;
  }

  private isSessionArchived(sessionId: string): boolean {
    return (
      this.workspaceRegistry()?.archivedSessionIds.includes(sessionId as never) ??
      false
    );
  }

  /**
   * Create a brand-new session for `channel`, exactly the way the very first
   * inbound message on a binding does: same preset, same cwd default, same
   * default-model seed. Shared by first-time conversation binding and by the
   * archived-session rebind paths below so "start over" always means the
   * same recipe.
   */
  private async createBoundSession(
    channel: StoredMessageChannel,
  ): Promise<{ sessionId: string; dispose: () => Promise<void> }> {
    const sessionId = `session-${randomUUID()}`;
    const runtime = this.ctx as MessageRuntimeContext;
    const agentOptions = this.defaultAgentOptions();
    const handle = await this.ctx.agents.create({
      sessionId: sessionId as never,
      // Agent presets (e.g. `restricted`'s persona section) reference
      // `{{cwd}}`, resolved from `agent.session.header.cwd`. IM-originated
      // sessions have no workspace of their own — mirror the desktop
      // host's own default for a no-workspace session (dsh-host-apiproxy)
      // by seeding the runtime process's own working directory, a valid
      // absolute path, rather than leaving it unset and failing prompt
      // assembly on the first turn. The RESUME path can't inject a cwd —
      // it comes from the persisted session header — so only CREATE needs
      // this; a session created with a cwd carries it into future resumes.
      meta: {
        cwd: process.cwd(),
        ...(channel.agentPreset ? { agentPreset: channel.agentPreset } : {}),
      },
      ...(agentOptions ? { agentOptions } : {}),
      setup: async (agentCtx: Context) => {
        try {
          await runtime.agentPresets.mount(agentCtx, channel.agentPreset);
        } catch (error) {
          this.ctx
            .logger("amiba-messaging-core")
            .warn(
              `Could not mount agent preset "${String(channel.agentPreset)}" for channel ${channel.id} (session ${sessionId}); continuing without it: ${String(error)}`,
            );
        }
      },
    });
    return { sessionId, dispose: () => handle.dispose().catch(() => undefined) };
  }

  /**
   * `channel.sessionId`'s fixed single-session binding (no per-conversation
   * routing). An empty string means the channel relies on
   * `resolveConversationSession` entirely — left untouched, `acceptInbound`
   * already rejects it as `conversation_required`.
   */
  private resolveChannelSession(
    channel: StoredMessageChannel,
  ): Promise<string> {
    if (!channel.sessionId || !this.isSessionArchived(channel.sessionId))
      return Promise.resolve(channel.sessionId);
    // Single-flight per channel, same shape as `resolveConversationSession`'s
    // `conversationCreates`: two inbounds racing in on this fixed-session
    // channel while `channel.sessionId` is archived would otherwise both
    // read the same stale id, both create a session, and orphan the loser's.
    const key = channel.id;
    const existing = this.channelCreates.get(key);
    if (existing) return existing;
    const previousSessionId = channel.sessionId;
    const resolve = (async () => {
      this.ctx
        .logger("amiba-messaging-core")
        .info(
          `Channel ${channel.id} was bound to archived session ${previousSessionId}; starting a fresh session.`,
        );
      const { sessionId, dispose } = await this.createBoundSession(channel);
      try {
        await this.store.update(channel.id, { sessionId });
      } catch (error) {
        await dispose();
        throw error;
      }
      this.approvals.cancelForSession(previousSessionId);
      return sessionId;
    })().finally(() => {
      this.channelCreates.delete(key);
    });
    this.channelCreates.set(key, resolve);
    return resolve;
  }

  private resolveConversationSession(
    channel: StoredMessageChannel,
    conversation: InboundConversationRef,
  ): Promise<string> {
    const key = `${channel.id}:${conversation.key}`;
    const existing = this.conversationCreates.get(key);
    if (existing) return existing;
    const resolve = (async () => {
      const bound = await this.store.findConversation(
        channel.id,
        conversation.key,
      );
      if (bound && !this.isSessionArchived(bound.sessionId)) return bound.sessionId;
      if (bound) {
        // Amiba's session "delete" is becoming DSH's host-side archive, and
        // archived = closed everywhere in Amiba. Start over exactly like the
        // very first inbound message on this binding — new session, same
        // preset/cwd — and cancel any approval question still waiting on the
        // old one: it can never be answered, since every future inbound
        // message on this conversation now routes to the new session.
        this.ctx
          .logger("amiba-messaging-core")
          .info(
            `Conversation ${channel.id}:${conversation.key} was bound to archived session ${bound.sessionId}; starting a fresh session.`,
          );
      }
      const { sessionId, dispose } = await this.createBoundSession(channel);
      try {
        await this.store.bindConversation({
          channelId: channel.id,
          conversationKey: conversation.key,
          kind: conversation.kind,
          ...(conversation.title ? { title: conversation.title } : {}),
          sessionId,
        });
      } catch (error) {
        await dispose();
        throw error;
      }
      if (bound) this.approvals.cancelForSession(bound.sessionId);
      return sessionId;
    })().finally(() => {
      this.conversationCreates.delete(key);
    });
    this.conversationCreates.set(key, resolve);
    return resolve;
  }

  async acceptInbound(
    channelId: string,
    secret: string,
    envelope: InboundMessageEnvelope,
  ): Promise<{
    accepted: boolean;
    duplicate: boolean;
    sessionId: string;
    /** True when the message answered a pending approval instead of the model. */
    consumedAsApproval?: boolean;
  }> {
    const channel = (await this.store.list()).find(
      (item) => item.id === channelId,
    );
    if (!channel || !channel.enabled) throw new Error("channel_not_found");
    const provider = this.providers.get(channel.provider);
    if (!provider?.supportsInbound) throw new Error("inbound_not_supported");
    if (!constantTimeSecretMatches(secret, channel.secretHash))
      throw new Error("unauthorized");
    if (!envelope.id.trim() || !envelope.text.trim())
      throw new Error("invalid_message");
    if (
      channel.allowedSenders.length > 0 &&
      (!envelope.sender || !channel.allowedSenders.includes(envelope.sender))
    )
      throw new Error("sender_not_allowed");

    const sessionId = envelope.conversation
      ? await this.resolveConversationSession(channel, envelope.conversation)
      : await this.resolveChannelSession(channel);
    if (!sessionId) throw new Error("conversation_required");
    const receiptKey = `${channel.id}:${envelope.id.trim()}`;
    // An approval answer is consumed here, BEFORE it can become a user turn:
    // the sender already passed this channel's `allowedSenders` rule above, so
    // whoever may talk to the bot may also answer its approvals (plan §2).
    // Anything the protocol cannot parse — or aimed at a number nobody is
    // waiting on — falls through to the normal inbound path untouched.
    if (this.approvals.matchesPending(channel.id, sessionId, envelope.text)) {
      // Claim the receipt FIRST. A transport that redelivers an answer we
      // already consumed must not settle whatever question is pending now:
      // "同意" sent for question #1 must never grant question #2 because the
      // network duplicated it after #1 closed.
      // In the narrow window between the probe and this write the question
      // may have settled on its own (a deadline); the answer then grants
      // nothing, but its receipt is ours, so it stays consumed either way.
      const fresh = await this.store.acceptReceipt(receiptKey);
      if (fresh)
        this.approvals.answerFromText(
          channel.id,
          sessionId,
          envelope.text,
          envelope.sender,
        );
      return {
        accepted: true,
        duplicate: !fresh,
        sessionId,
        consumedAsApproval: true,
      };
    }
    const agent = await this.ensureAgent(sessionId);
    const message = createUserMessage({
      content: [{ type: "text", text: envelope.text.trim() }],
      source: {
        kind: "plugin",
        plugin: `amiba-message:${channel.id}`,
        form: "relay",
      },
    });
    const acceptedAt = new Date().toISOString();
    const fresh = await this.store.acceptInbound({
      key: receiptKey,
      channelId: channel.id,
      messageId: envelope.id.trim(),
      sessionId,
      dshMessageId: message.id,
      text: envelope.text.trim(),
      ...(envelope.sender ? { sender: envelope.sender } : {}),
      ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
      acceptedAt,
    });
    if (!fresh)
      return { accepted: true, duplicate: true, sessionId };
    try {
      agent.followup(message);
    } catch (error) {
      this.ctx
        .logger("amiba-messaging-core")
        .error(
          `Accepted ${receiptKey} durably but could not wake its Agent: ${String(error)}`,
        );
      void this.recoverPending();
    }
    return { accepted: true, duplicate: false, sessionId };
  }

  private ensureAgent(sessionId: string): Promise<Agent> {
    const live = this.ctx.agents.get(sessionId as never) as Agent | undefined;
    if (live) return Promise.resolve(live);
    const existing = this.resumes.get(sessionId);
    if (existing) return existing;
    const runtime = this.ctx as MessageRuntimeContext;
    const resume = (async () => {
      const inspected = await runtime.sessionPersistence.inspect(sessionId);
      const preset = presetForSession(inspected);
      const agentOptions = this.defaultAgentOptions();
      const handle = await this.ctx.agents.resume({
        resumeSessionId: sessionId as never,
        ...(agentOptions ? { agentOptions } : {}),
        setup: async (agentCtx) => {
          try {
            await runtime.agentPresets.mount(agentCtx, preset);
          } catch (error) {
            this.ctx
              .logger("amiba-messaging-core")
              .warn(
                `Could not mount agent preset "${String(preset)}" while resuming session ${sessionId}; continuing without it: ${String(error)}`,
              );
          }
        },
      });
      return handle.agent;
    })()
      .catch((error) => {
        const raced = this.ctx.agents.get(sessionId as never) as
          | Agent
          | undefined;
        if (raced) return raced;
        throw error;
      })
      .finally(() => {
        this.resumes.delete(sessionId);
      });
    this.resumes.set(sessionId, resume);
    return resume;
  }

  private async reconcileSession(session: Session): Promise<void> {
    const pending = await this.store.listPending(session.id);
    for (const item of pending) {
      const reply = completedTurnReply(session.events, item);
      if (!reply) continue;
      await this.store.queueReply(item.key, {
        id: `${reply.messageId}:${item.channelId}:${item.messageId}`,
        channelId: item.channelId,
        sessionId: item.sessionId,
        inReplyTo: item.messageId,
        text: reply.text,
        createdAt: new Date(reply.time).toISOString(),
      });
    }
    void this.pumpDeliveries();
  }

  private recoverPending(): Promise<void> {
    if (this.recovery) return this.recovery;
    this.recovery = (async () => {
      const pending = await this.store.listPending();
      const sessionIds = [...new Set(pending.map((item) => item.sessionId))];
      for (const sessionId of sessionIds) {
        try {
          const agent = await this.ensureAgent(sessionId);
          await this.reconcileSession(agent.session);
          const remaining = await this.store.listPending(sessionId);
          const persistedMessageIds = new Set(
            agent.session.events.flatMap((event) => {
              const id = eventMessageId(event);
              return id ? [id] : [];
            }),
          );
          const inboxIds = new Set(
            [...agent.inbox.nextTurn, ...agent.inbox.nextStep].map(
              (message) => message.id as string,
            ),
          );
          for (const item of remaining) {
            if (
              persistedMessageIds.has(item.dshMessageId) ||
              inboxIds.has(item.dshMessageId)
            )
              continue;
            agent.followup(restoredMessage(item));
            inboxIds.add(item.dshMessageId);
          }
        } catch (error) {
          this.ctx
            .logger("amiba-messaging-core")
            .error(
              `Failed to recover pending messages for ${sessionId}: ${String(error)}`,
            );
        }
      }
    })().finally(() => {
      this.recovery = null;
    });
    return this.recovery;
  }

  private pumpDeliveries(): Promise<void> {
    if (this.deliveryPump) return this.deliveryPump;
    this.deliveryPump = this.deliverDue().finally(() => {
      this.deliveryPump = null;
    });
    return this.deliveryPump;
  }

  private async deliverDue(): Promise<void> {
    const [outbox, channels] = await Promise.all([
      this.store.listOutbox(),
      this.store.list(),
    ]);
    const channelById = new Map(
      channels.map((channel) => [channel.id, channel]),
    );
    const now = Date.now();
    for (const delivery of outbox) {
      if (!delivery.nextAttemptAt || Date.parse(delivery.nextAttemptAt) > now)
        continue;
      const channel = channelById.get(delivery.channelId);
      if (!channel?.enabled) continue;
      const provider = this.providers.get(channel.provider);
      if (!provider) {
        await this.failDelivery(delivery, "provider_unregistered");
        continue;
      }
      if (!provider.supportsOutbound || !provider.deliver) {
        await this.store.markDelivered(delivery.id);
        continue;
      }
      await this.deliverOne(provider, channel, delivery);
    }
  }

  private async deliverOne(
    provider: MessageChannelProvider,
    channel: StoredMessageChannel,
    delivery: StoredOutboundDelivery,
  ): Promise<void> {
    // `reconcileSession` queued this reply while `delivery.envelope.sessionId`
    // was still current; the session can have been archived since — e.g. a
    // concurrent inbound rebound the conversation to a fresh session — by
    // the time the pump gets around to actually delivering it. Delivering it
    // now would land a reply from the old, archived session into a
    // conversation that has moved on. Retrying later can never help (the
    // session stays archived), so settle it terminal immediately instead of
    // going through the backoff schedule — same shape (`nextAttemptAt`
    // cleared, entry kept for diagnostics) `failDelivery` already uses once
    // DELIVERY_MAX_ATTEMPTS is reached, not a new outbox status.
    if (this.isSessionArchived(delivery.envelope.sessionId)) {
      this.ctx
        .logger("amiba-messaging-core")
        .warn(
          `Dropping outbound delivery ${delivery.id}: its session ${delivery.envelope.sessionId} was archived before delivery; the conversation has since moved on.`,
        );
      await this.store.markDeliveryFailed(delivery.id, "session_archived", undefined);
      this.approvals.abandonPrompt(delivery.id);
      return;
    }
    try {
      await provider.deliver!(channel, delivery.envelope);
      await this.store.markDelivered(delivery.id);
    } catch (error) {
      await this.failDelivery(delivery, String(error));
    }
  }

  // Same backoff formula as deliverOne's failure path, shared so a channel
  // whose provider has been unregistered retries instead of being dropped.
  private async failDelivery(
    delivery: StoredOutboundDelivery,
    reason: string,
  ): Promise<void> {
    const attempts = delivery.attempts + 1;
    const terminal = attempts >= DELIVERY_MAX_ATTEMPTS;
    const retryAt = terminal
      ? undefined
      : new Date(
          Date.now() + Math.min(60 * 60_000, 2_000 * 2 ** attempts),
        ).toISOString();
    await this.store.markDeliveryFailed(delivery.id, reason, retryAt);
    // Out of retries: an approval prompt sitting in this envelope will never
    // reach its conversation, so wake the relay and let it delegate to the
    // desktop answerer instead of holding the tool call open.
    if (terminal) this.approvals.abandonPrompt(delivery.id);
    this.ctx
      .logger("amiba-messaging-core")
      .error(
        `Outbound delivery ${delivery.id} failed on attempt ${attempts}/${DELIVERY_MAX_ATTEMPTS}: ${reason}`,
      );
  }
}

export function applyMessageCenter(
  ctx: Context,
  root: string,
): MessageChannelCenter {
  const center = new MessageChannelCenter(ctx, new MessageCenterStore(root));
  ctx.provide("amibaMessageCenter", center);
  return center;
}
