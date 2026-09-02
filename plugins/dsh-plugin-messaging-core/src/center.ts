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
  hashChannelSecret,
  MessageCenterStore,
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
  return { ...safe, delivery };
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
  // Published by dsh-host-apiproxy (and mirrored by any host that seeds
  // agent sessions); absent on headless runtimes, so read it defensively.
  agentDefaultModel?: {
    currentSelection(): {
      provider: string;
      model: string;
      reasoningEffort?: unknown;
    };
  };
}

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
  private recovery: Promise<void> | null = null;
  private deliveryPump: Promise<void> | null = null;
  private started = false;

  constructor(
    private readonly ctx: Context,
    readonly store: MessageCenterStore,
  ) {
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
  }): Promise<{ channel: MessageChannelView; secret: string }> {
    const provider = this.providers.get(input.provider);
    if (!provider) throw new Error("provider_not_found");
    if (!input.name.trim()) throw new Error("invalid_channel");
    if (!input.sessionId?.trim() && !input.agentPreset?.trim())
      throw new Error("invalid_channel");
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
   * `agentDefaultModel` — callers must tolerate its absence. */
  private defaultAgentOptions(): { provider: string; model: string } | undefined {
    const selection = (
      this.ctx as MessageRuntimeContext
    ).agentDefaultModel?.currentSelection?.();
    return selection
      ? { provider: selection.provider, model: selection.model }
      : undefined;
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
      if (bound) return bound.sessionId;
      const sessionId = `session-${randomUUID()}`;
      const runtime = this.ctx as MessageRuntimeContext;
      const agentOptions = this.defaultAgentOptions();
      const handle = await this.ctx.agents.create({
        sessionId: sessionId as never,
        meta: channel.agentPreset ? { agentPreset: channel.agentPreset } : {},
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
      try {
        await this.store.bindConversation({
          channelId: channel.id,
          conversationKey: conversation.key,
          kind: conversation.kind,
          ...(conversation.title ? { title: conversation.title } : {}),
          sessionId,
        });
      } catch (error) {
        await handle.dispose().catch(() => undefined);
        throw error;
      }
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
  ): Promise<{ accepted: boolean; duplicate: boolean; sessionId: string }> {
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
      : channel.sessionId;
    if (!sessionId) throw new Error("conversation_required");
    const agent = await this.ensureAgent(sessionId);
    const message = createUserMessage({
      content: [{ type: "text", text: envelope.text.trim() }],
      source: {
        kind: "plugin",
        plugin: `amiba-message:${channel.id}`,
        form: "relay",
      },
    });
    const receiptKey = `${channel.id}:${envelope.id}`;
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
