import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type {
  ConnectorProviderView,
  ConnectView,
  ConnectDetails,
  UpdateConnectInput,
  OnboardingView,
} from "./types.js";

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
  messaging: z.object({ ownerPairing: z.boolean() }).optional(),
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
      pollOnboarding(sessionId: string): Promise<RemoteResult<OnboardingView>>;
      cancelOnboarding(
        sessionId: string,
      ): Promise<RemoteResult<OnboardingView>>;
    };
  }

  interface TypertRemoteMap {
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
