import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type {
  MessageChannelProviderView,
  MessageChannelView,
} from "./center.js";
import type { MessageChannelApproval } from "./store.js";

export interface MessageChannelInput {
  provider: string;
  name: string;
  sessionId: string;
  outboundUrl?: string;
  allowedSenders?: string[];
  approval?: MessageChannelApproval;
}

export type MessageChannelPatch = Partial<
  Omit<MessageChannelInput, "provider">
> & { enabled?: boolean };

export interface MessageCenterSnapshot {
  providers: MessageChannelProviderView[];
  channels: MessageChannelView[];
  inboundEndpoint: string;
}

export interface MessageChannelSecret {
  channel: MessageChannelView;
  secret: string;
}

const approvalSchema = z.object({
  mode: z.union([z.literal("timeout"), z.literal("wait")]),
  timeoutMs: z.number(),
});

const deliverySchema = z.object({
  pendingInbound: z.number(),
  queuedOutbound: z.number(),
  failedOutbound: z.number(),
  lastDeliveryError: z.string().optional(),
});

const channelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  sessionId: z.string(),
  enabled: z.boolean(),
  outboundUrl: z.string().optional(),
  allowedSenders: z.array(z.string()),
  approval: approvalSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  delivery: deliverySchema,
});

const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  supportsInbound: z.boolean(),
  supportsOutbound: z.boolean(),
  inboundPath: z.string().optional(),
});

const inputSchema = z.object({
  provider: z.string(),
  name: z.string(),
  sessionId: z.string(),
  outboundUrl: z.string().optional(),
  allowedSenders: z.array(z.string()).optional(),
  approval: approvalSchema.optional(),
});

const patchSchema = z.object({
  name: z.string().optional(),
  sessionId: z.string().optional(),
  outboundUrl: z.string().optional(),
  allowedSenders: z.array(z.string()).optional(),
  approval: approvalSchema.optional(),
  enabled: z.boolean().optional(),
});

const snapshotSchema = z.object({
  providers: z.array(providerSchema),
  channels: z.array(channelSchema),
  inboundEndpoint: z.string(),
});

const secretSchema = z.object({ channel: channelSchema, secret: z.string() });
const removeSchema = z.object({ id: z.string(), deleted: z.boolean() });

function codec<T>(schema: z.ZodType<T>, typeSymbol: string) {
  return { mode: "strict" as const, typeSymbol, schema };
}

const stringCodec = codec(z.string(), "typescript#string");

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaMessaging: {
      list(): Promise<RemoteResult<MessageCenterSnapshot>>;
      create(input: MessageChannelInput): Promise<RemoteResult<MessageChannelSecret>>;
      update(
        id: string,
        patch: MessageChannelPatch,
      ): Promise<RemoteResult<MessageChannelView>>;
      removeChannel(
        id: string,
      ): Promise<RemoteResult<{ id: string; deleted: boolean }>>;
      rotate(id: string): Promise<RemoteResult<MessageChannelSecret>>;
    };
  }

  interface TypertRemoteMap {
    "amibaMessaging/list": () => Promise<RemoteResult<MessageCenterSnapshot>>;
    "amibaMessaging/create": (
      input: MessageChannelInput,
    ) => Promise<RemoteResult<MessageChannelSecret>>;
    "amibaMessaging/update": (
      id: string,
      patch: MessageChannelPatch,
    ) => Promise<RemoteResult<MessageChannelView>>;
    "amibaMessaging/removeChannel": (
      id: string,
    ) => Promise<RemoteResult<{ id: string; deleted: boolean }>>;
    "amibaMessaging/rotate": (
      id: string,
    ) => Promise<RemoteResult<MessageChannelSecret>>;
  }
}

const descriptor = (
  method: string,
  parameters: TypertRemoteContribution["descriptors"][number]["parameters"],
  result: TypertRemoteContribution["descriptors"][number]["result"],
): TypertRemoteContribution["descriptors"][number] => ({
  id: `@amiba/dsh-plugin-messaging-core#amibaMessaging/${method}`,
  service: "amibaMessaging",
  namespace: "amibaMessaging",
  method,
  invocation: { kind: "direct" },
  parameters,
  result,
});

/** Strict Client descriptors for messaging-core's DSH Typert Remote face. */
export const AMIBA_MESSAGING_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-messaging-core",
  descriptors: [
    descriptor("list", [], codec(snapshotSchema, "@amiba/messaging#snapshot")),
    descriptor(
      "create",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: codec(inputSchema, "@amiba/messaging#channel-input"),
        },
      ],
      codec(secretSchema, "@amiba/messaging#channel-secret"),
    ),
    descriptor(
      "update",
      [
        { name: "id", wire: "id", source: "json", codec: stringCodec },
        {
          name: "patch",
          wire: "patch",
          source: "json",
          codec: codec(patchSchema, "@amiba/messaging#channel-patch"),
        },
      ],
      codec(channelSchema, "@amiba/messaging#channel"),
    ),
    descriptor(
      "removeChannel",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      codec(removeSchema, "@amiba/messaging#remove"),
    ),
    descriptor(
      "rotate",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      codec(secretSchema, "@amiba/messaging#channel-secret"),
    ),
  ],
};
