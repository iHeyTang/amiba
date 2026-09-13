import type { ExternalSessionInfo } from "./session-origin.js";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { SharedResourceSearch } from "./conversation-sharing.js";
import type { MessageConversationSettingsInput, MessageConversationView } from "@amiba/dsh-plugin-messaging-core";
export type { MessageConversationSettingsInput, MessageConversationView } from "@amiba/dsh-plugin-messaging-core";

const conversationViewSchema = z.object({
  access: z.enum(["owner", "shared"]),
  policy: z.object({ cadence: z.enum(["daily", "weekly", "manual"]), timeZone: z.string() }),
  currentSessionId: z.string().optional(),
  pendingNewConversation: z.boolean(),
  history: z.array(z.object({ sessionId: z.string(), createdAt: z.number() })),
  sharedResources: z.array(z.object({ reference: z.string(), title: z.string() })),
});

import type {
  ConnectorProviderView,
  ConnectView,
  ConnectDetails,
  UpdateConnectInput,
  OnboardingView,
} from "./types.js";

export interface ConnectorMessageSource {
  id: string;
  provider: string;
  providerName: string;
  accountName: string;
}

export interface CreateConnectInput {
  provider: string;
  name: string;
  agentPreset: string;
  config: Record<string, unknown>;
}

export interface BeginOnboardingInput {
  provider: string;
  name: string;
  agentPreset: string;
}

export interface AmibaConnectorsProvidersSnapshot {
  providers: ConnectorProviderView[];
}

export interface AmibaConnectorsConnectsSnapshot {
  connects: ConnectView[];
}

// Discriminated on `state`, matching ConnectorStatus in ./types.ts exactly.
// Additive union: "off"/"degraded" are new members alongside the Task-2-era
// "connecting"/"ready"/"error" ones — an older client decoding a status it
// doesn't recognize is an unavoidable, unrelated concern (it never worked
// for genuinely novel states), but every status a Task-2-era server could
// ever have emitted still decodes exactly as before.
const connectorStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("off") }),
  z.object({ state: z.literal("connecting") }),
  z.object({ state: z.literal("ready") }),
  z.object({ state: z.literal("degraded"), detail: z.string() }),
  z.object({ state: z.literal("error"), detail: z.string() }),
]);

const providerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  supportsOnboarding: z.boolean(),
  messaging: z.object({ ownerPairing: z.boolean(), sharedConversations: z.boolean().optional() }).optional(),
});

// No secret or config field: ConnectView never carries credential material,
// and this schema must never grow one either.
const connectViewSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  pairing: z.boolean(),
  owners: z.array(z.string()),
  agentPreset: z.string().optional(),
  status: connectorStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createConnectInputSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    agentPreset: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

const updateConnectInputSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    agentPreset: z.string().trim().min(1).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const connectDetailsSchema = z.object({
  capabilityUses: z.array(z.object({ name: z.string(), capabilities: z.array(z.string()) })).optional(),
  connect: connectViewSchema,
  settings: z.record(z.string(), z.unknown()),
  access: z.object({
    identity: z.enum(["application", "user"]), label: z.string().optional(),
    state: z.enum(["unauthorized", "authorized", "expired"]),
    capabilities: z.array(z.object({ id: z.string(), available: z.boolean() })),
  }).optional(),
  messaging: z
    .object({
      delivery: z.object({
        pendingInbound: z.number(),
        queuedOutbound: z.number(),
        failedOutbound: z.number(),
        lastDeliveryError: z.string().optional(),
      }),
      conversations: z.array(
        z.object({
          key: z.string(),
          kind: z.enum(["p2p", "group"]),
          title: z.string().optional(),
          sessionId: z.string(),
        }),
      ),
    })
    .optional(),
});

const beginOnboardingInputSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    agentPreset: z.string().min(1),
  })
  .strict();

const onboardingStateSchema = z.enum([
  "pending",
  "completed",
  "error",
  "cancelled",
]);

// No config/credential field: an OnboardingView never carries the fake (or
// real) provider config it was built from — only the resulting ConnectView
// once completed, which itself carries no secret material either (see
// connectViewSchema above). This schema must never grow one.
const onboardingViewSchema = z.object({
  input: z.object({ id: z.string(), label: z.string() }).optional(),
  sessionId: z.string(),
  state: onboardingStateSchema,
  qrUrl: z.string().optional(),
  qrExpireIn: z.number().optional(),
  statusNote: z.string().optional(),
  connect: connectViewSchema.optional(),
  error: z.string().optional(),
});

const listProvidersResultSchema = z.object({
  providers: z.array(providerViewSchema),
});
const listConnectsResultSchema = z.object({
  connects: z.array(connectViewSchema),
});
const removeResultSchema = z.object({ id: z.string(), deleted: z.boolean() });

function codec<T>(schema: z.ZodType<T>, typeSymbol: string) {
  return { mode: "strict" as const, typeSymbol, schema };
}

const stringCodec = codec(z.string(), "typescript#string");
const booleanCodec = codec(z.boolean(), "typescript#boolean");
const ownersCodec = codec(z.array(z.string()), "@amiba/connectors#owners");

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaConnectors: {
      messageSources(): Promise<RemoteResult<ConnectorMessageSource[]>>;
      externalSessions(ids: string[]): Promise<RemoteResult<ExternalSessionInfo[]>>;
      searchConversationResources(id: string, key: string, query: string): Promise<RemoteResult<SharedResourceSearch>>;
      shareConversationResources(id: string, key: string, references: string[]): Promise<RemoteResult<MessageConversationView>>;
      retryFailedReplies(id: string): Promise<RemoteResult<{ retried: number }>>;
      conversationSettings(id: string, conversationKey: string, input: MessageConversationSettingsInput): Promise<RemoteResult<MessageConversationView>>;
      getConnectDetails(id: string): Promise<RemoteResult<ConnectDetails>>;
      updateConnect(
        id: string,
        input: UpdateConnectInput,
      ): Promise<RemoteResult<ConnectView>>;
      listProviders(): Promise<RemoteResult<AmibaConnectorsProvidersSnapshot>>;
      listConnects(): Promise<RemoteResult<AmibaConnectorsConnectsSnapshot>>;
      createConnect(
        input: CreateConnectInput,
      ): Promise<RemoteResult<ConnectView>>;
      setEnabled(
        id: string,
        enabled: boolean,
      ): Promise<RemoteResult<ConnectView>>;
      removeConnect(
        id: string,
      ): Promise<RemoteResult<{ id: string; deleted: boolean }>>;
      setOwners(
        id: string,
        owners: string[],
      ): Promise<RemoteResult<ConnectView>>;
      beginOnboarding(
        input: BeginOnboardingInput,
      ): Promise<RemoteResult<OnboardingView>>;
      submitOnboardingInput(sessionId: string, inputId: string, value: string): Promise<RemoteResult<OnboardingView>>;
      pollOnboarding(sessionId: string): Promise<RemoteResult<OnboardingView>>;
      cancelOnboarding(
        sessionId: string,
      ): Promise<RemoteResult<OnboardingView>>;
    };
  }

  interface TypertRemoteMap {
    "amibaConnectors/messageSources": () => Promise<RemoteResult<ConnectorMessageSource[]>>;
    "amibaConnectors/externalSessions": (ids: string[]) => Promise<RemoteResult<ExternalSessionInfo[]>>;
    "amibaConnectors/searchConversationResources": (id: string, key: string, query: string) => Promise<RemoteResult<SharedResourceSearch>>;
    "amibaConnectors/shareConversationResources": (id: string, key: string, references: string[]) => Promise<RemoteResult<MessageConversationView>>;
    "amibaConnectors/retryFailedReplies": (id: string) => Promise<RemoteResult<{ retried: number }>>;
    "amibaConnectors/conversationSettings": (id: string, conversationKey: string, input: MessageConversationSettingsInput) => Promise<RemoteResult<MessageConversationView>>;
    "amibaConnectors/getConnectDetails": (
      id: string,
    ) => Promise<RemoteResult<ConnectDetails>>;
    "amibaConnectors/updateConnect": (
      id: string,
      input: UpdateConnectInput,
    ) => Promise<RemoteResult<ConnectView>>;
    "amibaConnectors/listProviders": () => Promise<
      RemoteResult<AmibaConnectorsProvidersSnapshot>
    >;
    "amibaConnectors/listConnects": () => Promise<
      RemoteResult<AmibaConnectorsConnectsSnapshot>
    >;
    "amibaConnectors/createConnect": (
      input: CreateConnectInput,
    ) => Promise<RemoteResult<ConnectView>>;
    "amibaConnectors/setEnabled": (
      id: string,
      enabled: boolean,
    ) => Promise<RemoteResult<ConnectView>>;
    "amibaConnectors/removeConnect": (
      id: string,
    ) => Promise<RemoteResult<{ id: string; deleted: boolean }>>;
    "amibaConnectors/setOwners": (
      id: string,
      owners: string[],
    ) => Promise<RemoteResult<ConnectView>>;
    "amibaConnectors/beginOnboarding": (
      input: BeginOnboardingInput,
    ) => Promise<RemoteResult<OnboardingView>>;
    "amibaConnectors/submitOnboardingInput": (sessionId: string, inputId: string, value: string) => Promise<RemoteResult<OnboardingView>>;
    "amibaConnectors/pollOnboarding": (
      sessionId: string,
    ) => Promise<RemoteResult<OnboardingView>>;
    "amibaConnectors/cancelOnboarding": (
      sessionId: string,
    ) => Promise<RemoteResult<OnboardingView>>;
  }
}

const descriptor = (
  method: string,
  parameters: TypertRemoteContribution["descriptors"][number]["parameters"],
  result: TypertRemoteContribution["descriptors"][number]["result"],
): TypertRemoteContribution["descriptors"][number] => ({
  id: `@amiba/dsh-plugin-connector-core#amibaConnectors/${method}`,
  // Must match AmibaConnectorsRemoteService's actual Cordis service key
  // (remote-service.ts: `super(ctx, "amibaConnectorsRemote", { namespace:
  // "amibaConnectors" })`) — dsh-api-gateway resolves a strict descriptor's
  // receiver via `ctx.get(descriptor.service)` and then validates that
  // receiver's `typertRemote.serviceKey` against this same field (see
  // @deepseek-ai/dsh-api-gateway's `invoke`/`validateBinding`). `namespace`
  // stays "amibaConnectors": that's the wire endpoint
  // (`<namespace>/<method>`) the client and
  // `TypertRemoteNamespaceMap.amibaConnectors` augmentation below key off,
  // and it's unaffected by the service-key rename.
  service: "amibaConnectorsRemote",
  namespace: "amibaConnectors",
  method,
  invocation: { kind: "direct" },
  parameters,
  result,
});

/** Strict Client descriptors for connector-core's DSH Typert Remote face. */
export const AMIBA_CONNECTORS_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-connector-core",
  descriptors: [
    descriptor("messageSources", [], codec(z.array(z.object({ id: z.string(), provider: z.string(), providerName: z.string(), accountName: z.string() })), "@amiba/connectors#message-sources")),
    descriptor("externalSessions", [
      { name: "ids", wire: "ids", source: "json", codec: codec(z.array(z.string()).max(100), "@amiba/connectors#session-candidates") },
    ], codec(z.array(z.object({ id: z.string(), connectorName: z.string(), createdAt: z.number() })), "@amiba/connectors#external-sessions")),
    descriptor("searchConversationResources", [
      { name: "id", wire: "id", source: "json", codec: stringCodec },
      { name: "key", wire: "key", source: "json", codec: stringCodec },
      { name: "query", wire: "query", source: "json", codec: codec(z.string().trim().min(1).max(100), "@amiba/connectors#resource-query") },
    ], codec(z.object({ items: z.array(z.object({ reference: z.string(), title: z.string(), description: z.string().optional() })), unavailable: z.boolean() }), "@amiba/connectors#share-search")),
    descriptor("shareConversationResources", [
      { name: "id", wire: "id", source: "json", codec: stringCodec },
      { name: "key", wire: "key", source: "json", codec: stringCodec },
      { name: "references", wire: "references", source: "json", codec: codec(z.array(z.string().min(1).max(25000)).max(100), "@amiba/connectors#shared-references") },
    ], codec(conversationViewSchema, "@amiba/connectors#conversation-view")),
    descriptor("retryFailedReplies", [{ name: "id", wire: "id", source: "json", codec: stringCodec }], codec(z.object({ retried: z.number().int().nonnegative() }), "@amiba/connectors#retry-result")),
    descriptor("conversationSettings", [
      { name: "id", wire: "id", source: "json", codec: stringCodec },
      { name: "conversationKey", wire: "conversationKey", source: "json", codec: stringCodec },
      { name: "input", wire: "input", source: "json", codec: codec(z.object({ action: z.enum(["status", "configure", "new"]), cadence: z.enum(["daily", "weekly", "manual"]).optional() }).strict(), "@amiba/connectors#conversation-settings-input") },
    ], codec(conversationViewSchema, "@amiba/connectors#conversation-view")),
    descriptor(
      "getConnectDetails",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      codec(connectDetailsSchema, "@amiba/connectors#details"),
    ),
    descriptor(
      "updateConnect",
      [
        { name: "id", wire: "id", source: "json", codec: stringCodec },
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: codec(
            updateConnectInputSchema,
            "@amiba/connectors#update-input",
          ),
        },
      ],
      codec(connectViewSchema, "@amiba/connectors#connect"),
    ),
    descriptor(
      "listProviders",
      [],
      codec(listProvidersResultSchema, "@amiba/connectors#providers-snapshot"),
    ),
    descriptor(
      "listConnects",
      [],
      codec(listConnectsResultSchema, "@amiba/connectors#connects-snapshot"),
    ),
    descriptor(
      "createConnect",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: codec(
            createConnectInputSchema,
            "@amiba/connectors#create-input",
          ),
        },
      ],
      codec(connectViewSchema, "@amiba/connectors#connect"),
    ),
    descriptor(
      "setEnabled",
      [
        { name: "id", wire: "id", source: "json", codec: stringCodec },
        {
          name: "enabled",
          wire: "enabled",
          source: "json",
          codec: booleanCodec,
        },
      ],
      codec(connectViewSchema, "@amiba/connectors#connect"),
    ),
    descriptor(
      "removeConnect",
      [{ name: "id", wire: "id", source: "json", codec: stringCodec }],
      codec(removeResultSchema, "@amiba/connectors#remove"),
    ),
    descriptor(
      "setOwners",
      [
        { name: "id", wire: "id", source: "json", codec: stringCodec },
        {
          name: "owners",
          wire: "owners",
          source: "json",
          codec: ownersCodec,
        },
      ],
      codec(connectViewSchema, "@amiba/connectors#connect"),
    ),
    descriptor(
      "beginOnboarding",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: codec(
            beginOnboardingInputSchema,
            "@amiba/connectors#begin-onboarding-input",
          ),
        },
      ],
      codec(onboardingViewSchema, "@amiba/connectors#onboarding"),
    ),
    descriptor(
      "submitOnboardingInput",
      [
        { name: "sessionId", wire: "sessionId", source: "json", codec: stringCodec },
        { name: "inputId", wire: "inputId", source: "json", codec: stringCodec },
        { name: "value", wire: "value", source: "json", codec: stringCodec },
      ],
      codec(onboardingViewSchema, "@amiba/connectors#onboarding"),
    ),
    descriptor(
      "pollOnboarding",
      [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: stringCodec,
        },
      ],
      codec(onboardingViewSchema, "@amiba/connectors#onboarding"),
    ),
    descriptor(
      "cancelOnboarding",
      [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: stringCodec,
        },
      ],
      codec(onboardingViewSchema, "@amiba/connectors#onboarding"),
    ),
  ],
};
