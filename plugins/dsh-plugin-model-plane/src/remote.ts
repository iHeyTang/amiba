import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type {
  AgentModelSelection,
  ModelDefinition,
  ModelPlaneSnapshot,
  ModelProviderProfile,
} from "@amiba/app-runtime/platform";

const effortSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  wireValue: z.string().nullable().optional(),
});
const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  inputModalities: z.array(z.string()).optional(),
  reasoning: z
    .object({
      efforts: z.array(effortSchema),
      defaultEffort: z.string().optional(),
    })
    .optional(),
});
const providerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  protocol: z.enum([
    "deepseek-chat-completions",
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "provider-native",
  ]),
  baseURL: z.string().optional(),
  credentialRef: z.string().optional(),
  enabled: z.boolean(),
  editable: z.boolean(),
  source: z.enum(["builtin", "user", "imported"]),
  models: z.array(modelSchema),
});
const selectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string().optional(),
});
const snapshotSchema = z.object({
  revision: z.number(),
  providers: z.array(providerSchema),
  groups: z.array(
    z.object({ id: z.string(), name: z.string(), models: z.array(modelSchema) }),
  ),
  defaultSelection: selectionSchema.optional(),
  credentials: z.record(
    z.string(),
    z.object({
      configured: z.boolean(),
      source: z.string().optional(),
      writable: z.boolean(),
    }),
  ),
  failures: z.array(
    z.object({ id: z.string(), name: z.string(), message: z.string() }),
  ),
});
const revisionSchema = z.number().int().nonnegative().optional();
const upsertSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().optional(),
  expectedRevision: revisionSchema,
});
const discoverSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().optional(),
});
const discoveryResultSchema = z.object({ models: z.array(modelSchema) });

function codec<T>(schema: z.ZodType<T>, typeSymbol: string) {
  return { mode: "strict" as const, typeSymbol, schema };
}

const stringCodec = codec(z.string(), "typescript#string");
const optionalRevisionCodec = codec(
  revisionSchema,
  "@amiba/model-plane#optional-revision",
);

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaModelPlane: {
      snapshot(): Promise<RemoteResult<ModelPlaneSnapshot>>;
      setDefaultSelection(
        selection: AgentModelSelection,
        expectedRevision?: number,
      ): Promise<RemoteResult<ModelPlaneSnapshot>>;
      upsert(input: {
        provider: ModelProviderProfile;
        apiKey?: string;
        expectedRevision?: number;
      }): Promise<RemoteResult<ModelPlaneSnapshot>>;
      remove(
        providerId: string,
        expectedRevision?: number,
      ): Promise<RemoteResult<ModelPlaneSnapshot>>;
      discover(input: {
        provider: ModelProviderProfile;
        apiKey?: string;
      }): Promise<RemoteResult<{ models: ModelDefinition[] }>>;
      unsetCredential(
        providerId: string,
        expectedRevision?: number,
      ): Promise<RemoteResult<ModelPlaneSnapshot>>;
    };
  }

  interface TypertRemoteMap {
    "amibaModelPlane/snapshot": TypertRemoteNamespaceMap["amibaModelPlane"]["snapshot"];
    "amibaModelPlane/setDefaultSelection": TypertRemoteNamespaceMap["amibaModelPlane"]["setDefaultSelection"];
    "amibaModelPlane/upsert": TypertRemoteNamespaceMap["amibaModelPlane"]["upsert"];
    "amibaModelPlane/remove": TypertRemoteNamespaceMap["amibaModelPlane"]["remove"];
    "amibaModelPlane/discover": TypertRemoteNamespaceMap["amibaModelPlane"]["discover"];
    "amibaModelPlane/unsetCredential": TypertRemoteNamespaceMap["amibaModelPlane"]["unsetCredential"];
  }
}

function descriptor(
  method: string,
  parameters: TypertRemoteContribution["descriptors"][number]["parameters"],
  result: TypertRemoteContribution["descriptors"][number]["result"],
): TypertRemoteContribution["descriptors"][number] {
  return {
    id: `@amiba/dsh-plugin-model-plane#amibaModelPlane/${method}`,
    service: "amibaModelPlane",
    namespace: "amibaModelPlane",
    method,
    invocation: { kind: "direct" },
    parameters,
    result,
  };
}

const snapshotResult = codec(
  snapshotSchema,
  "@amiba/model-plane#snapshot",
);

/** Strict DSH Client contract for the harness-independent Model Plane. */
export const AMIBA_MODEL_PLANE_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-model-plane",
  descriptors: [
    descriptor("snapshot", [], snapshotResult),
    descriptor(
      "setDefaultSelection",
      [
        {
          name: "selection",
          wire: "selection",
          source: "json",
          codec: codec(selectionSchema, "@amiba/model-plane#selection"),
        },
        {
          name: "expectedRevision",
          wire: "expectedRevision",
          source: "json",
          codec: optionalRevisionCodec,
        },
      ],
      snapshotResult,
    ),
    descriptor(
      "upsert",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: codec(upsertSchema, "@amiba/model-plane#upsert"),
        },
      ],
      snapshotResult,
    ),
    descriptor(
      "remove",
      [
        {
          name: "providerId",
          wire: "providerId",
          source: "json",
          codec: stringCodec,
        },
        {
          name: "expectedRevision",
          wire: "expectedRevision",
          source: "json",
          codec: optionalRevisionCodec,
        },
      ],
      snapshotResult,
    ),
    descriptor(
      "discover",
      [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: codec(discoverSchema, "@amiba/model-plane#discover"),
        },
      ],
      codec(discoveryResultSchema, "@amiba/model-plane#discovery-result"),
    ),
    descriptor(
      "unsetCredential",
      [
        {
          name: "providerId",
          wire: "providerId",
          source: "json",
          codec: stringCodec,
        },
        {
          name: "expectedRevision",
          wire: "expectedRevision",
          source: "json",
          codec: optionalRevisionCodec,
        },
      ],
      snapshotResult,
    ),
  ],
};
