import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_VERSION = 1;
const MAX_RECEIPTS = 1_000;

export interface StoredMessageChannel {
  id: string;
  provider: string;
  name: string;
  sessionId: string;
  enabled: boolean;
  secretHash: string;
  outboundUrl?: string;
  allowedSenders: string[];
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
  key: string;
  acceptedAt: string;
}

interface MessageCenterDocument {
  version: 1;
  channels: StoredMessageChannel[];
  receipts: StoredReceipt[];
  pending: StoredPendingInbound[];
  outbox: StoredOutboundDelivery[];
}

function emptyDocument(): MessageCenterDocument {
  return {
    version: STATE_VERSION,
    channels: [],
    receipts: [],
    pending: [],
    outbox: [],
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))].slice(0, 500);
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
        channels: Array.isArray(parsed.channels)
          ? parsed.channels.map(normalizeChannel).filter((item): item is StoredMessageChannel => Boolean(item))
          : [],
        receipts: Array.isArray(parsed.receipts)
          ? parsed.receipts.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const row = item as Record<string, unknown>;
              return typeof row.key === "string" && typeof row.acceptedAt === "string"
                ? [{ key: row.key, acceptedAt: row.acceptedAt }]
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
    sessionId: string;
    outboundUrl?: string;
    allowedSenders?: string[];
  }): Promise<{ channel: StoredMessageChannel; secret: string }> {
    return this.mutate((document) => {
      const secret = generateChannelSecret();
      const now = new Date().toISOString();
      const channel: StoredMessageChannel = {
        id: `channel-${randomUUID()}`,
        provider: input.provider,
        name: input.name.trim(),
        sessionId: input.sessionId.trim(),
        enabled: true,
        secretHash: hashChannelSecret(secret),
        ...(input.outboundUrl?.trim() ? { outboundUrl: input.outboundUrl.trim() } : {}),
        allowedSenders: normalizeStringList(input.allowedSenders),
        createdAt: now,
        updatedAt: now,
      };
      document.channels.push(channel);
      return { channel, secret };
    });
  }

  update(id: string, patch: Partial<Pick<StoredMessageChannel,
    "name" | "sessionId" | "enabled" | "outboundUrl" | "allowedSenders"
  >>): Promise<StoredMessageChannel> {
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

  acceptReceipt(key: string): Promise<boolean> {
    return this.mutate((document) => {
      if (document.receipts.some((item) => item.key === key)) return false;
      document.receipts.push({ key, acceptedAt: new Date().toISOString() });
      document.receipts = document.receipts.slice(-MAX_RECEIPTS);
      return true;
    });
  }

  acceptInbound(input: StoredPendingInbound): Promise<boolean> {
    return this.mutate((document) => {
      if (document.receipts.some((item) => item.key === input.key)) return false;
      document.receipts.push({ key: input.key, acceptedAt: input.acceptedAt });
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
      if (!document.outbox.some((item) => item.id === envelope.id)) {
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
      return true;
    });
  }

  listOutbox(): Promise<StoredOutboundDelivery[]> {
    return this.chain.then(async () => (await this.readDocument()).outbox);
  }

  markDelivered(id: string): Promise<void> {
    return this.mutate((document) => {
      document.outbox = document.outbox.filter((item) => item.id !== id);
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
}
