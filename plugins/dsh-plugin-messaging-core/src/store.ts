import type { DesktopSyncPolicy, DesktopSyncDelivery } from "./desktop-sync.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_VERSION = 1;
const MAX_RECEIPTS = 1_000;

export interface StoredConversationBinding {
  access?: "owner" | "shared";
  /** Superseded routes remain available for in-flight replies and approvals. */
  superseded?: boolean;
  channelId: string;
  conversationKey: string;
  kind: "p2p" | "group";
  title?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * How long a channel waits for a human to answer a tool-approval question
 * relayed into the IM conversation. `timeout` settles `rejected` once
 * `timeoutMs` elapses (the model then continues with a refusal); `wait` never
 * settles on its own and holds the tool call until somebody answers or the
 * turn is cancelled.
 */
export interface MessageChannelApproval {
  mode: "timeout" | "wait";
  timeoutMs: number;
}

/** Applied to channels stored before the field existed (plan §2/§4). */
export const DEFAULT_CHANNEL_APPROVAL: MessageChannelApproval = {
  mode: "timeout",
  timeoutMs: 600_000,
};

/** Floor for `timeoutMs` — a shorter window cannot reach a human in an IM. */
export const MIN_APPROVAL_TIMEOUT_MS = 10_000;

/** The channel's effective approval policy, defaulted for older rows. */
export function resolveChannelApproval(
  channel: Pick<StoredMessageChannel, "approval">,
): MessageChannelApproval {
  return channel.approval ?? DEFAULT_CHANNEL_APPROVAL;
}

export interface StoredMessageChannel {
  id: string;
  provider: string;
  name: string;
  sessionId: string;
  enabled: boolean;
  secretHash: string;
  outboundUrl?: string;
  allowedSenders: string[];
  agentPreset?: string;
  approval?: MessageChannelApproval;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPendingInbound {
  key: string;
  channelId: string;
  messageId: string;
  sessionId: string;
  dshMessageId: string;
  text: string;
  sender?: string;
  metadata?: Record<string, unknown>;
  acceptedAt: string;
}

export interface StoredOutboundEnvelope {
  id: string;
  channelId: string;
  sessionId: string;
  inReplyTo: string;
  sync?: DesktopSyncDelivery["sync"];
  text: string;
  createdAt: string;
}

export interface StoredOutboundDelivery {
  id: string;
  channelId: string;
  envelope: StoredOutboundEnvelope;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageChannelDeliveryStatus {
  pendingInbound: number;
  queuedOutbound: number;
  failedOutbound: number;
  lastDeliveryError?: string;
}

interface StoredReceipt {
  sessionId?: string;
  consumedAsApproval?: boolean;
  key: string;
  acceptedAt: string;
}

interface MessageCenterDocument {
  version: 1;
  channels: StoredMessageChannel[];
  receipts: StoredReceipt[];
  pending: StoredPendingInbound[];
  outbox: StoredOutboundDelivery[];
  conversations: StoredConversationBinding[];
  syncPolicies: Record<string, DesktopSyncPolicy>;
  syncLedger: Record<string, { envelope: StoredOutboundEnvelope; state: "queued" | "sent" | "cancelled" }>;
}

function normalizeSyncPolicies(value: unknown): Record<string, DesktopSyncPolicy> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_sync_policies");
  const result: Record<string, DesktopSyncPolicy> = {};
  for (const [scope, policy] of Object.entries(value)) {
    if (!policy || typeof policy !== "object" || typeof policy.enabled !== "boolean" ||
      !Number.isFinite(policy.since) || !policy.floors || typeof policy.floors !== "object" || Array.isArray(policy.floors) ||
      Object.values(policy.floors).some(seq => !Number.isSafeInteger(seq))) throw new Error("invalid_sync_policy");
    result[scope] = policy;
  }
  return result;
}

function normalizeSyncLedger(value: unknown): MessageCenterDocument["syncLedger"] {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_sync_ledger");
  const result: MessageCenterDocument["syncLedger"] = {};
  for (const [id, row] of Object.entries(value)) {
    const envelope = row && normalizeOutboundEnvelope(row.envelope);
    if (!envelope?.sync || envelope.id !== id || !["queued", "sent", "cancelled"].includes(row.state)) throw new Error("invalid_sync_receipt");
    result[id] = { envelope, state: row.state };
  }
  return result;
}

function emptyDocument(): MessageCenterDocument {
  return {
    version: STATE_VERSION,
    channels: [],
    receipts: [],
    pending: [],
    outbox: [],
    conversations: [],
    syncPolicies: {},
    syncLedger: {},
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))].slice(0, 500);
}

function normalizeApproval(value: unknown): MessageChannelApproval | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (row.mode !== "timeout" && row.mode !== "wait") return undefined;
  if (!Number.isSafeInteger(row.timeoutMs) || (row.timeoutMs as number) <= 0)
    return undefined;
  return { mode: row.mode, timeoutMs: row.timeoutMs as number };
}

function normalizeChannel(value: unknown): StoredMessageChannel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.provider !== "string" ||
    typeof row.name !== "string" ||
    typeof row.sessionId !== "string" ||
    typeof row.secretHash !== "string"
  ) return null;
  const now = new Date(0).toISOString();
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    sessionId: row.sessionId,
    enabled: row.enabled === true,
    secretHash: row.secretHash,
    ...(typeof row.outboundUrl === "string" && row.outboundUrl
      ? { outboundUrl: row.outboundUrl }
      : {}),
    allowedSenders: normalizeStringList(row.allowedSenders),
    ...(typeof row.agentPreset === "string" && row.agentPreset
      ? { agentPreset: row.agentPreset }
      : {}),
    ...(normalizeApproval(row.approval)
      ? { approval: normalizeApproval(row.approval)! }
      : {}),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
  };
}

function normalizePending(value: unknown): StoredPendingInbound | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.key !== "string" ||
    typeof row.channelId !== "string" ||
    typeof row.messageId !== "string" ||
    typeof row.sessionId !== "string" ||
    typeof row.dshMessageId !== "string" ||
    typeof row.text !== "string" ||
    typeof row.acceptedAt !== "string"
  ) return null;
  return {
    key: row.key,
    channelId: row.channelId,
    messageId: row.messageId,
    sessionId: row.sessionId,
    dshMessageId: row.dshMessageId,
    text: row.text,
    ...(typeof row.sender === "string" ? { sender: row.sender } : {}),
    ...(row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? { metadata: row.metadata as Record<string, unknown> }
      : {}),
    acceptedAt: row.acceptedAt,
  };
}

function normalizeConversation(value: unknown): StoredConversationBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.channelId !== "string" ||
    typeof row.conversationKey !== "string" ||
    (row.kind !== "p2p" && row.kind !== "group") ||
    typeof row.sessionId !== "string" ||
    typeof row.createdAt !== "string" ||
    typeof row.updatedAt !== "string"
  ) return null;
  return {
    ...(row.access === "shared" ? { access: "shared" as const } : {}),
    ...(row.superseded === true ? { superseded: true } : {}),
    channelId: row.channelId,
    conversationKey: row.conversationKey,
    kind: row.kind,
    ...(typeof row.title === "string" && row.title ? { title: row.title } : {}),
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeOutboundEnvelope(value: unknown): StoredOutboundEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.channelId !== "string" ||
    typeof row.sessionId !== "string" ||
    typeof row.inReplyTo !== "string" ||
    typeof row.text !== "string" ||
    typeof row.createdAt !== "string"
  ) return null;
  if (row.sync !== undefined) {
    const sync = row.sync as Record<string, unknown>;
    if (!sync || typeof sync !== "object" || typeof sync.scope !== "string" ||
      typeof sync.sourceMessageId !== "string" || !["user", "assistant"].includes(String(sync.author)) || sync.source !== "desktop" ||
      (sync.policySince !== undefined && !Number.isFinite(sync.policySince))) throw new Error("invalid_sync_envelope");
  }
  return row as unknown as StoredOutboundEnvelope;
}

function normalizeOutbound(value: unknown): StoredOutboundDelivery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const envelope = normalizeOutboundEnvelope(row.envelope);
  if (
    typeof row.id !== "string" ||
    typeof row.channelId !== "string" ||
    !envelope ||
    !Number.isSafeInteger(row.attempts) ||
    typeof row.createdAt !== "string" ||
    typeof row.updatedAt !== "string"
  ) return null;
  return {
    id: row.id,
    channelId: row.channelId,
    envelope,
    attempts: row.attempts as number,
    ...(typeof row.nextAttemptAt === "string" ? { nextAttemptAt: row.nextAttemptAt } : {}),
    ...(typeof row.lastError === "string" ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function hashChannelSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateChannelSecret(): string {
  return `amiba_${randomBytes(32).toString("base64url")}`;
}

function pushOutbound(
  document: MessageCenterDocument,
  envelope: StoredOutboundEnvelope,
): void {
  if (document.outbox.some((item) => item.id === envelope.id) || document.syncLedger[envelope.id]) return;
  if (envelope.sync) {
    const policy = document.syncPolicies[envelope.sync.scope];
    if (!policy?.enabled || (envelope.sync.policySince !== undefined && policy.since !== envelope.sync.policySince)) return;
    document.syncLedger[envelope.id] = { envelope, state: "queued" };
  }
  const now = new Date().toISOString();
  document.outbox.push({
    id: envelope.id,
    channelId: envelope.channelId,
    envelope,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

export class MessageCenterStore {
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.path = join(root, "message-center.json");
  }

  private async readDocument(): Promise<MessageCenterDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      if (parsed.version !== STATE_VERSION) throw new Error("unsupported message-center state");
      return {
        version: STATE_VERSION,
        syncPolicies: normalizeSyncPolicies(parsed.syncPolicies),
        syncLedger: normalizeSyncLedger(parsed.syncLedger),
        channels: Array.isArray(parsed.channels)
          ? parsed.channels.map(normalizeChannel).filter((item): item is StoredMessageChannel => Boolean(item))
          : [],
        receipts: Array.isArray(parsed.receipts)
          ? parsed.receipts.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const row = item as Record<string, unknown>;
              return typeof row.key === "string" && typeof row.acceptedAt === "string"
                ? [{ key: row.key, acceptedAt: row.acceptedAt, ...(typeof row.sessionId === "string" ? { sessionId: row.sessionId } : {}), ...(row.consumedAsApproval === true ? { consumedAsApproval: true } : {}) }]
                : [];
            }).slice(-MAX_RECEIPTS)
          : [],
        pending: Array.isArray(parsed.pending)
          ? parsed.pending
              .map(normalizePending)
              .filter((item): item is StoredPendingInbound => Boolean(item))
          : [],
        outbox: Array.isArray(parsed.outbox)
          ? parsed.outbox
              .map(normalizeOutbound)
              .filter((item): item is StoredOutboundDelivery => Boolean(item))
          : [],
        conversations: Array.isArray(parsed.conversations)
          ? parsed.conversations
              .map(normalizeConversation)
              .filter((item): item is StoredConversationBinding => Boolean(item))
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDocument();
      throw error;
    }
  }

  private async writeDocument(document: MessageCenterDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  private mutate<T>(operation: (document: MessageCenterDocument) => Promise<T> | T): Promise<T> {
    const result = this.chain.then(async () => {
      const document = await this.readDocument();
      const value = await operation(document);
      await this.writeDocument(document);
      return value;
    });
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  list(): Promise<StoredMessageChannel[]> {
    return this.chain.then(async () => (await this.readDocument()).channels);
  }

  create(input: {
    provider: string;
    name: string;
    sessionId?: string;
    outboundUrl?: string;
    allowedSenders?: string[];
    agentPreset?: string;
    approval?: MessageChannelApproval;
  }): Promise<{ channel: StoredMessageChannel; secret: string }> {
    return this.mutate((document) => {
      const secret = generateChannelSecret();
      const now = new Date().toISOString();
      const channel: StoredMessageChannel = {
        id: `channel-${randomUUID()}`,
        provider: input.provider,
        name: input.name.trim(),
        sessionId: input.sessionId?.trim() ?? "",
        enabled: true,
        secretHash: hashChannelSecret(secret),
        ...(input.outboundUrl?.trim() ? { outboundUrl: input.outboundUrl.trim() } : {}),
        allowedSenders: normalizeStringList(input.allowedSenders),
        ...(input.agentPreset?.trim() ? { agentPreset: input.agentPreset.trim() } : {}),
        ...(normalizeApproval(input.approval)
          ? { approval: normalizeApproval(input.approval)! }
          : {}),
        createdAt: now,
        updatedAt: now,
      };
      document.channels.push(channel);
      return { channel, secret };
    });
  }

  /**
   * Patch one channel. Every key is optional and `undefined` means "leave
   * alone"; `approval: null` is the explicit clear, so a caller rolling a row
   * back to "no policy of its own" can express that (an omitted `approval`
   * could only ever set a value).
   */
  update(id: string, patch: Partial<Pick<StoredMessageChannel,
    "name" | "sessionId" | "enabled" | "outboundUrl" | "allowedSenders" | "agentPreset"
  >> & { approval?: MessageChannelApproval | null }): Promise<StoredMessageChannel> {
    return this.mutate((document) => {
      const index = document.channels.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("channel_not_found");
      const current = document.channels[index]!;
      const channel: StoredMessageChannel = {
        ...current,
        ...(typeof patch.name === "string" ? { name: patch.name.trim() } : {}),
        ...(typeof patch.sessionId === "string" ? { sessionId: patch.sessionId.trim() } : {}),
        ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
        ...(patch.outboundUrl === undefined
          ? {}
          : patch.outboundUrl.trim()
            ? { outboundUrl: patch.outboundUrl.trim() }
            : { outboundUrl: undefined }),
        ...(patch.allowedSenders === undefined
          ? {}
          : { allowedSenders: normalizeStringList(patch.allowedSenders) }),
        ...(patch.agentPreset === undefined
          ? {}
          : patch.agentPreset.trim()
            ? { agentPreset: patch.agentPreset.trim() }
            : { agentPreset: undefined }),
        ...(patch.approval === undefined
          ? {}
          : patch.approval === null
            ? { approval: undefined }
            : { approval: normalizeApproval(patch.approval) }),
        updatedAt: new Date().toISOString(),
      };
      document.channels[index] = channel;
      return channel;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.mutate((document) => {
      const before = document.channels.length;
      document.channels = document.channels.filter((item) => item.id !== id);
      document.pending = document.pending.filter((item) => item.channelId !== id);
      document.outbox = document.outbox.filter((item) => item.channelId !== id);
      document.conversations = document.conversations.filter(
        (item) => item.channelId !== id,
      );
      return document.channels.length !== before;
    });
  }

  rotate(id: string): Promise<{ channel: StoredMessageChannel; secret: string }> {
    return this.mutate((document) => {
      const channel = document.channels.find((item) => item.id === id);
      if (!channel) throw new Error("channel_not_found");
      const secret = generateChannelSecret();
      channel.secretHash = hashChannelSecret(secret);
      channel.updatedAt = new Date().toISOString();
      return { channel, secret };
    });
  }

  findReceipt(key: string): Promise<StoredReceipt | undefined> {
    return this.chain.then(async () => (await this.readDocument()).receipts.find((item) => item.key === key));
  }

  acceptReceipt(key: string, sessionId?: string): Promise<boolean> {
    return this.mutate((document) => {
      if (document.receipts.some((item) => item.key === key)) return false;
      document.receipts.push({ key, acceptedAt: new Date().toISOString(), ...(sessionId ? { sessionId, consumedAsApproval: true } : {}) });
      document.receipts = document.receipts.slice(-MAX_RECEIPTS);
      return true;
    });
  }

  acceptInbound(input: StoredPendingInbound): Promise<boolean> {
    return this.mutate((document) => {
      if (document.receipts.some((item) => item.key === input.key)) return false;
      document.receipts.push({ key: input.key, acceptedAt: input.acceptedAt, sessionId: input.sessionId });
      document.receipts = document.receipts.slice(-MAX_RECEIPTS);
      document.pending.push(input);
      return true;
    });
  }

  listPending(sessionId?: string): Promise<StoredPendingInbound[]> {
    return this.chain.then(async () => {
      const pending = (await this.readDocument()).pending;
      return sessionId
        ? pending.filter((item) => item.sessionId === sessionId)
        : pending;
    });
  }

  queueReply(
    pendingKey: string,
    envelope: StoredOutboundEnvelope,
  ): Promise<boolean> {
    return this.mutate((document) => {
      const index = document.pending.findIndex((item) => item.key === pendingKey);
      if (index < 0) return false;
      document.pending.splice(index, 1);
      pushOutbound(document, envelope);
      return true;
    });
  }

  /**
   * Queue an outbound message that answers no pending inbound record — the
   * approval relay's prompts and outcome notices. Same durable outbox, same
   * pump, same backoff as a turn reply; only the correlation differs.
   */
  queueOutbound(envelope: StoredOutboundEnvelope): Promise<void> {
    return this.mutate((document) => {
      pushOutbound(document, envelope);
    });
  }

  syncPolicies(): Promise<Record<string, DesktopSyncPolicy>> {
    return this.chain.then(async () => (await this.readDocument()).syncPolicies);
  }

  configureSync(scope: string, policy: DesktopSyncPolicy): Promise<void> {
    return this.mutate(document => {
      document.syncPolicies[scope] = policy;
      if (!policy.enabled) {
        const cancelled = document.outbox.filter(item => item.envelope.sync?.scope === scope);
        for (const item of cancelled) if (document.syncLedger[item.id]) document.syncLedger[item.id].state = "cancelled";
        document.outbox = document.outbox.filter(item => item.envelope.sync?.scope !== scope);
      }
    });
  }

  syncStatus(scope: string) {
    return this.chain.then(async () => {
      const doc = await this.readDocument();
      return { enabled: doc.syncPolicies[scope]?.enabled === true,
        messages: Object.values(doc.syncLedger).filter(row => row.envelope.sync?.scope === scope).slice(-50).map(row => {
          const pending = doc.outbox.find(item => item.id === row.envelope.id);
          return { id: row.envelope.id, sourceMessageId: row.envelope.sync!.sourceMessageId,
            sessionId: row.envelope.sessionId, author: row.envelope.sync!.author, text: row.envelope.text,
            state: row.state === "queued" && pending?.lastError ? "failed" as const : row.state,
            ...(pending?.lastError ? { error: pending.lastError } : {}) };
        }) };
    });
  }

  listOutbox(): Promise<StoredOutboundDelivery[]> {
    return this.chain.then(async () => (await this.readDocument()).outbox);
  }

  markSyncSending(id: string): Promise<boolean> {
    return this.mutate(document => {
      const delivery = document.outbox.find(item => item.id === id);
      if (!delivery?.envelope.sync || !document.syncPolicies[delivery.envelope.sync.scope]?.enabled) return false;
      // A crash after the platform accepts a request must not silently resend it.
      delivery.lastError = "sync_delivery_unconfirmed";
      delivery.nextAttemptAt = undefined;
      return true;
    });
  }

  markDelivered(id: string): Promise<void> {
    return this.mutate((document) => {
      if (document.syncLedger[id]) document.syncLedger[id].state = "sent";
      document.outbox = document.outbox.filter((item) => item.id !== id);
    });
  }

  retryDeliveries(channelId: string, ids: readonly string[]): Promise<number> {
    const selected = new Set(ids);
    return this.mutate(document => {
      let count = 0;
      for (const delivery of document.outbox) {
        if (delivery.channelId !== channelId || !selected.has(delivery.id) || !delivery.lastError || delivery.envelope.inReplyTo.startsWith("approval:")) continue;
        delivery.attempts = 0;
        delivery.nextAttemptAt = new Date().toISOString();
        delivery.updatedAt = delivery.nextAttemptAt;
        count++;
      }
      return count;
    });
  }

  markDeliveryFailed(
    id: string,
    error: string,
    nextAttemptAt?: string,
  ): Promise<void> {
    return this.mutate((document) => {
      const delivery = document.outbox.find((item) => item.id === id);
      if (!delivery) return;
      delivery.attempts += 1;
      delivery.lastError = error.slice(0, 2_000);
      delivery.updatedAt = new Date().toISOString();
      delivery.nextAttemptAt = nextAttemptAt;
    });
  }

  async deliveryStatus(): Promise<Map<string, MessageChannelDeliveryStatus>> {
    const document = await this.chain.then(() => this.readDocument());
    const status = new Map<string, MessageChannelDeliveryStatus>();
    const ensure = (channelId: string) => {
      const current = status.get(channelId) ?? {
        pendingInbound: 0,
        queuedOutbound: 0,
        failedOutbound: 0,
      };
      status.set(channelId, current);
      return current;
    };
    for (const item of document.pending) ensure(item.channelId).pendingInbound += 1;
    for (const item of document.outbox) {
      const current = ensure(item.channelId);
      if (item.nextAttemptAt) current.queuedOutbound += 1;
      else current.failedOutbound += 1;
      if (item.lastError) current.lastDeliveryError = item.lastError;
    }
    return status;
  }

  findConversation(
    channelId: string,
    conversationKey: string,
  ): Promise<StoredConversationBinding | undefined> {
    return this.chain.then(async () =>
      (await this.readDocument()).conversations.find(
        (item) =>
          item.channelId === channelId &&
          item.conversationKey === conversationKey && !item.superseded,
      ),
    );
  }

  findConversationBySession(
    sessionId: string,
  ): Promise<StoredConversationBinding | undefined> {
    return this.chain.then(async () =>
      (await this.readDocument()).conversations.find(
        (item) => item.sessionId === sessionId,
      ),
    );
  }

  listConversations(channelId?: string, includeSuperseded = false): Promise<StoredConversationBinding[]> {
    return this.chain.then(async () => {
      const conversations = (await this.readDocument()).conversations.filter((item) => includeSuperseded || !item.superseded);
      return channelId
        ? conversations.filter((item) => item.channelId === channelId)
        : conversations;
    });
  }

  bindConversation(
    input: Omit<StoredConversationBinding, "createdAt" | "updatedAt">,
  ): Promise<StoredConversationBinding> {
    return this.mutate((document) => {
      const now = new Date().toISOString();
      const index = document.conversations.findIndex(
        (item) =>
          item.channelId === input.channelId &&
          item.conversationKey === input.conversationKey && !item.superseded,
      );
      const binding: StoredConversationBinding = {
        ...(input.access === "shared" ? { access: "shared" } : {}),
        channelId: input.channelId,
        conversationKey: input.conversationKey,
        kind: input.kind,
        ...(input.title ? { title: input.title } : {}),
        sessionId: input.sessionId,
        createdAt: index >= 0 && document.conversations[index]!.sessionId === input.sessionId ? document.conversations[index]!.createdAt : now,
        updatedAt: now,
      };
      if (index >= 0 && document.conversations[index]!.sessionId === input.sessionId) document.conversations[index] = binding;
      else {
        if (index >= 0) document.conversations[index]!.superseded = true;
        document.conversations.push(binding);
      }
      return binding;
    });
  }

  removeConversation(
    channelId: string,
    conversationKey: string,
  ): Promise<boolean> {
    return this.mutate((document) => {
      const before = document.conversations.length;
      document.conversations = document.conversations.filter(
        (item) =>
          !(item.channelId === channelId &&
            item.conversationKey === conversationKey),
      );
      return document.conversations.length !== before;
    });
  }
}


export function conversationAccessScope(conversation: { key: string; kind: "p2p" | "group"; access?: "owner" | "shared" }): string {
  return conversation.access === "shared" ? JSON.stringify(["shared", conversation.kind, conversation.key]) : conversation.key;
}
