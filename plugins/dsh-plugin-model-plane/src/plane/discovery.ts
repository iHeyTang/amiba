import type { ModelDefinition } from "@amiba/app-runtime/platform";

import type { ModelProviderProfile } from "./types.js";

import { asObject } from "./core.js";

export function modelDiscoveryUrl(provider: ModelProviderProfile): URL {
  const defaultBase =
    provider.protocol === "deepseek-chat-completions"
      ? "https://api.deepseek.com"
      : undefined;
  const base = provider.baseURL ?? defaultBase;
  if (!base) throw new Error("A provider base URL is required for discovery");
  const normalized = new URL(base.endsWith("/") ? base : `${base}/`);
  if (normalized.pathname.endsWith("/models/")) return normalized;
  return new URL("models", normalized);
}

export function discoveredModels(
  value: unknown,
  configured: readonly ModelDefinition[],
): ModelDefinition[] {
  const body = asObject(value);
  const rows = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
      ? body.models
      : [];
  const configuredById = new Map(configured.map((model) => [model.id, model]));
  const seen = new Set<string>();
  return rows.flatMap((raw) => {
    const row = asObject(raw);
    const id = typeof row.id === "string" ? row.id : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const existing = configuredById.get(id);
    return [
      {
        ...existing,
        id,
        name:
          typeof row.display_name === "string"
            ? row.display_name
            : typeof row.name === "string"
              ? row.name
              : (existing?.name ?? id),
        ...(typeof row.context_window === "number"
          ? { contextWindow: row.context_window }
          : {}),
        ...(typeof row.max_output_tokens === "number"
          ? { maxTokens: row.max_output_tokens }
          : {}),
        // The provider's own answer outranks anything a driver table or an
        // earlier discovery left behind. Without this the row was read for
        // context window and output tokens but not for what the model can
        // actually be fed, so a stale `["text"]` survived every re-discovery.
        ...(Array.isArray(row.input_modalities)
          ? {
              inputModalities: row.input_modalities.filter(
                (item): item is string => typeof item === "string" && !!item,
              ),
            }
          : {}),
      },
    ];
  });
}

export interface DiscoverModelsOptions {
  apiKey?: string;
  resolveCredential?: (ref: string) => Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
}

/** Discover provider rows straight from the provider's own /models response. */
export async function discoverModelsFromProvider(
  provider: ModelProviderProfile,
  options: DiscoverModelsOptions = {},
): Promise<ModelDefinition[]> {
  if (provider.protocol === "provider-native") {
    throw new Error(
      "This provider does not expose a standard model discovery API",
    );
  }
  const credential =
    options.apiKey?.trim() ||
    (provider.credentialRef && options.resolveCredential
      ? await options.resolveCredential(provider.credentialRef)
      : undefined);
  if (!credential) throw new Error("An API key is required to discover models");
  const headers = new Headers({ accept: "application/json" });
  if (provider.protocol === "anthropic-messages") {
    headers.set("x-api-key", credential);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("authorization", `Bearer ${credential}`);
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(modelDiscoveryUrl(provider), {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    const error = asObject(asObject(body).error);
    const message =
      typeof error.message === "string"
        ? error.message
        : `Provider model discovery failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return discoveredModels(body, provider.models);
}
