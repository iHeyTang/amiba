import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type {
  ConnectorProviderView,
  ConnectView,
  MessageChannelApproval,
  OnboardingView,
} from "./types.js";

export interface CreateConnectInput {
  provider: string;
  name: string;
  agentPreset: string;
  config: Record<string, unknown>;
  /** Absent uses the bound channel's default (10-minute timeout). */
  approval?: MessageChannelApproval;
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
});

// No secret or config field: ConnectView never carries credential material,
// and this schema must never grow one either.
// Mirrors messaging-core's own MessageChannelApproval shape; timeoutMs is
// validated more strictly (>= MIN_APPROVAL_TIMEOUT_MS in `timeout` mode) by
// messageCenter.createChannel/updateChannel itself, not on the wire here.
const approvalSchema = z.object({
  mode: z.enum(["timeout", "wait"]),
  timeoutMs: z.number().int().positive(),
});

const connectViewSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  pairing: z.boolean(),
  owners: z.array(z.string()),
  agentPreset: z.string().optional(),
  channelId: z.string().optional(),
  approval: approvalSchema.optional(),
  status: connectorStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createConnectInputSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  agentPreset: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  approval: approvalSchema.optional(),
});

const beginOnboardingInputSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  agentPreset: z.string().min(1),
});

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
const approvalCodec = codec(approvalSchema, "@amiba/connectors#approval");

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaConnectors: {
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
      setApproval(
        id: string,
        approval: MessageChannelApproval,
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
    "amibaConnectors/setApproval": (
      id: string,
      approval: MessageChannelApproval,
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
      "setApproval",
      [
        { name: "id", wire: "id", source: "json", codec: stringCodec },
        {
          name: "approval",
          wire: "approval",
          source: "json",
          codec: approvalCodec,
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
