import type {
  AgentModelSelection,
  ModelDefinition,
  ModelGroup,
} from "@amiba/app-runtime/platform";

import type {
  ModelProviderProfile,
  ModelProviderProtocol,
} from "./types.js";

export type StoredModelProvider = ModelProviderProfile;

export interface StoredModelRegistry {
  version: 1;
  revision: number;
  providers: StoredModelProvider[];
  defaultSelection?: AgentModelSelection;
  projectionFailures: Array<{ id: string; name: string; message: string }>;
}

export const MODEL_REGISTRY_VERSION = 1;

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeModels(value: unknown): ModelDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const row = asObject(raw);
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const reasoning = asObject(row.reasoning);
    const effortIds = new Set<string>();
    const efforts = Array.isArray(reasoning.efforts)
      ? reasoning.efforts.flatMap((rawEffort) => {
          const effort = asObject(rawEffort);
          const effortId =
            typeof effort.id === "string" ? effort.id.trim() : "";
          if (
            !effortId ||
            effortIds.has(effortId) ||
            typeof effort.name !== "string" ||
            !effort.name.trim()
          )
            return [];
          effortIds.add(effortId);
          return [
            {
              id: effortId,
              name: effort.name.trim(),
              ...(typeof effort.description === "string" &&
              effort.description.trim()
                ? { description: effort.description.trim() }
                : {}),
              ...(effort.wireValue === null
                ? { wireValue: null }
                : typeof effort.wireValue === "string" &&
                    effort.wireValue.trim()
                  ? { wireValue: effort.wireValue.trim() }
                  : {}),
            },
          ];
        })
      : [];
    const requestedDefault =
      typeof reasoning.defaultEffort === "string"
        ? reasoning.defaultEffort
        : undefined;
    const defaultEffort = efforts.some(
      (effort) => effort.id === requestedDefault,
    )
      ? requestedDefault
      : undefined;
    return [
      {
        id,
        name:
          typeof row.name === "string" && row.name.trim()
            ? row.name.trim()
            : id,
        ...(row.enabled === false ? { enabled: false } : {}),
        ...(typeof row.description === "string" && row.description.trim()
          ? { description: row.description.trim() }
          : {}),
        ...(typeof row.contextWindow === "number" && row.contextWindow > 0
          ? { contextWindow: row.contextWindow }
          : {}),
        ...(typeof row.maxTokens === "number" && row.maxTokens > 0
          ? { maxTokens: row.maxTokens }
          : {}),
        ...(Array.isArray(row.inputModalities)
          ? {
              inputModalities: row.inputModalities.filter(
                (item): item is string => typeof item === "string" && !!item,
              ),
            }
          : {}),
        ...(efforts.length
          ? {
              reasoning: {
                efforts,
                ...(defaultEffort ? { defaultEffort } : {}),
              },
            }
          : {}),
      },
    ];
  });
}

export function isModelProviderProtocol(
  value: unknown,
): value is ModelProviderProtocol {
  return (
    value === "deepseek-chat-completions" ||
    value === "openai-completions" ||
    value === "openai-responses" ||
    value === "anthropic-messages" ||
    value === "provider-native"
  );
}

export function normalizeProvider(value: unknown): StoredModelProvider | null {
  const row = asObject(value);
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id || !isModelProviderProtocol(row.protocol)) return null;
  return {
    id,
    displayName:
      typeof row.displayName === "string" && row.displayName.trim()
        ? row.displayName.trim()
        : id,
    protocol: row.protocol,
    ...(typeof row.baseURL === "string" && row.baseURL.trim()
      ? { baseURL: row.baseURL.trim() }
      : {}),
    ...(typeof row.credentialRef === "string" && row.credentialRef.trim()
      ? { credentialRef: row.credentialRef.trim() }
      : {}),
    enabled: row.enabled !== false,
    editable: row.editable !== false,
    source:
      row.source === "builtin" ||
      row.source === "user" ||
      row.source === "imported"
        ? row.source
        : "imported",
    models: normalizeModels(row.models),
  };
}

export function normalizeRegistry(value: unknown): StoredModelRegistry | null {
  const row = asObject(value);
  if (row.version !== MODEL_REGISTRY_VERSION || !Array.isArray(row.providers))
    return null;
  const providers = row.providers.flatMap((provider) => {
    const normalized = normalizeProvider(provider);
    return normalized ? [normalized] : [];
  });
  const defaultSelection = normalizeDefaultSelection(
    row.defaultSelection,
    providers,
  );
  return {
    version: MODEL_REGISTRY_VERSION,
    revision:
      typeof row.revision === "number" && Number.isInteger(row.revision)
        ? row.revision
        : 0,
    providers,
    ...(defaultSelection ? { defaultSelection } : {}),
    projectionFailures: Array.isArray(row.projectionFailures)
      ? row.projectionFailures.flatMap((failure) => {
          const entry = asObject(failure);
          return typeof entry.id === "string" &&
            typeof entry.name === "string" &&
            typeof entry.message === "string"
            ? [{ id: entry.id, name: entry.name, message: entry.message }]
            : [];
        })
      : [],
  };
}

export function publicProvider(
  provider: StoredModelProvider,
): ModelProviderProfile {
  return provider;
}

export function groupsOf(
  providers: readonly StoredModelProvider[],
): ModelGroup[] {
  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      id: provider.id,
      name: provider.displayName,
      models: provider.models.filter((model) => model.enabled !== false),
    }));
}

export function normalizeDefaultSelection(
  value: unknown,
  providers: readonly StoredModelProvider[],
): AgentModelSelection | undefined {
  const row = asObject(value);
  const providerId =
    typeof row.provider === "string" ? row.provider.trim() : "";
  const modelId = typeof row.model === "string" ? row.model.trim() : "";
  const provider = providers.find(
    (candidate) => candidate.id === providerId && candidate.enabled,
  );
  const model = provider?.models.find(
    (candidate) => candidate.id === modelId && candidate.enabled !== false,
  );
  if (!provider || !model) return undefined;
  const requestedEffort =
    typeof row.reasoningEffort === "string" ? row.reasoningEffort.trim() : "";
  const reasoningEffort = model.reasoning?.efforts.some(
    (effort) => effort.id === requestedEffort,
  )
    ? requestedEffort
    : model.reasoning?.defaultEffort;
  return {
    provider: provider.id,
    model: model.id,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

export function defaultSelectionOf(
  registry: Pick<StoredModelRegistry, "providers" | "defaultSelection">,
): AgentModelSelection | undefined {
  const configured = normalizeDefaultSelection(
    registry.defaultSelection,
    registry.providers,
  );
  if (configured) return configured;
  const provider = registry.providers.find(
    (candidate) =>
      candidate.enabled &&
      candidate.models.some((model) => model.enabled !== false),
  );
  const model = provider?.models.find(
    (candidate) => candidate.enabled !== false,
  );
  if (!provider || !model) return undefined;
  return {
    provider: provider.id,
    model: model.id,
    ...(model.reasoning?.defaultEffort
      ? { reasoningEffort: model.reasoning.defaultEffort }
      : {}),
  };
}

export function credentialRefFor(providerId: string): string {
  return `${providerId.toUpperCase().replace(/[^A-Z0-9_]/gu, "_")}_API_KEY`;
}
