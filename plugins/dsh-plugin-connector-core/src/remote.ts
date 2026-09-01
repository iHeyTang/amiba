import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type { ConnectorProviderView, ConnectView } from "./types.js";

export interface CreateConnectInput {
  provider: string;
  name: string;
  agentPreset: string;
  config: Record<string, unknown>;
}

export interface AmibaConnectorsProvidersSnapshot {
  providers: ConnectorProviderView[];
}

export interface AmibaConnectorsConnectsSnapshot {
  connects: ConnectView[];
}

// Discriminated on `state`, matching ConnectorStatus in ./types.ts exactly.
const connectorStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("connecting") }),
  z.object({ state: z.literal("ready") }),
  z.object({ state: z.literal("error"), detail: z.string() }),
]);

const providerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().optional(),
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
  channelId: z.string().optional(),
  status: connectorStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createConnectInputSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  agentPreset: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
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
  ],
};
