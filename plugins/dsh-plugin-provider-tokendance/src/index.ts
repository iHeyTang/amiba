import type {} from "@deepseek-ai/dsh-settings";
import { TokenDanceAdapter } from "./adapter.js";
import type {} from "@amiba/dsh-plugin-media";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  LlmError,
  assertUsableApiKey,
  resolveRetryPolicy,
  attributionHeaders,
} from "@deepseek-ai/dsh-llm";
import {
  type ResolvedPiAiProviderProfile,
} from "@deepseek-ai/dsh-llm-pi-ai";
import {
  createProvider,
  InMemoryCredentialStore,
  defaultProviderAuthContext,
  type Model,
  type ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { parseCatalog, type CatalogModel, type Protocol } from "./catalog.js";
import seed from "./catalog-seed.json";
import { reasoningContract } from "./reasoning.js";

export const name = "llm-tokendance";
export const inject = ["llm", "credentials", "settings"];
export const PROVIDER = "tokendance";
export const NS = "llm-tokendance";
export interface ModelConfig {
  id: string;
  name?: string;
  description?: string;
  api?: Protocol;
  baseURL?: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
  reasoningEfforts?: false | Record<string, string | null>;
}
export interface ProfileConfig {
  apiKeyEnv: string;
  baseURL: string;
  refreshCatalog: boolean;
  models: ModelConfig[];
}
export const ProfileConfig: z<ProfileConfig> = z.object({
  apiKeyEnv: z
    .string()
    .role("credential-ref")
    .default("TOKENDANCE_API_KEY")
    .description("TokenDance API Key"),
  baseURL: z
    .string()
    .default("https://tokendance.space/gateway")
    .description("Gateway base URL"),
  refreshCatalog: z
    .boolean()
    .default(true)
    .description("Refresh the public model directory at startup"),
  models: z
    .array(
      z.object({
        id: z.string().required(),
        name: z.string(),
        description: z.string(),
        api: z.union([
          "openai-completions",
          "openai-responses",
          "anthropic-messages",
        ]),
        baseURL: z.string(),
        contextWindow: z.number().min(1),
        maxTokens: z.number().min(1),
        input: z.array(z.union(["text", "image"])),
        reasoningEfforts: z.union([
          z.const(false),
          z.dict(
            z.union([z.string(), z.const(null)]),
            z.union([
              "off",
              "minimal",
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
            ]),
          ),
        ]),
      }),
    )
    .default([])
    .description(
      "Models (empty uses the public catalog; protocol is selected per model)",
    ),
}) as unknown as z<ProfileConfig>;

export interface Config {
  providers: Record<string, ProfileConfig>;
}
export const Config: z<Config> = z.object({
  providers: z.dict(ProfileConfig).default({}),
});

function resolveProfiles(config: Config, catalog: CatalogModel[]) {
  return new Map(
    Object.entries(config.providers).map(([id, profile]) => {
      if (id !== PROVIDER)
        throw new Error(`Unsupported TokenDance route: ${id}`);
      return [id, resolveProfile(profile, catalog)] as const;
    }),
  );
}
const apis = {
  "openai-completions": openAICompletionsApi(),
  "openai-responses": openAIResponsesApi(),
  "anthropic-messages": anthropicMessagesApi(),
};
export function endpoint(base: string, api: Protocol): string {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("TokenDance endpoint must use HTTP or HTTPS");
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "TokenDance endpoint must not contain credentials, query or fragment",
    );
  const root = url.href.replace(/\/+$/, "").replace(/\/v1$/, "");
  return api === "anthropic-messages" ? root : `${root}/v1`;
}
function thinking(efforts: ModelConfig["reasoningEfforts"]): {
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
} {
  if (!efforts || !Object.keys(efforts).length) return { reasoning: false };
  const map: ThinkingLevelMap = {};
  const levels = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ] as const;
  if (
    !levels.some(
      (key) =>
        key !== "off" && typeof efforts[key] === "string" && efforts[key],
    )
  )
    throw new Error("reasoningEfforts must offer a thinking level");
  for (const key of levels) {
    const value = efforts[key];
    if (value === null && key !== "off")
      throw new Error(`reasoningEfforts.${key} requires a wire value`);
    if (value === undefined) map[key] = null;
    else if (value !== null) map[key] = value;
  }
  return { reasoning: true, thinkingLevelMap: map };
}
export function resolveProfile(
  config: ProfileConfig,
  catalog: readonly CatalogModel[],
): ResolvedPiAiProviderProfile {
  credentialRef(config.apiKeyEnv);
  endpoint(config.baseURL, "openai-completions");
  const known = new Map(catalog.map((model) => [model.id, model]));
  const rows: readonly ModelConfig[] = config.models.length
    ? config.models
    : catalog;
  const ids = new Set<string>();
  const models: Model<Protocol>[] = rows.map((row) => {
    if (!row.id || ids.has(row.id))
      throw new Error(`Invalid or duplicate TokenDance model: ${row.id}`);
    ids.add(row.id);
    const base = known.get(row.id);
    const contract = reasoningContract(row.id);
    const preferredApi = contract && base?.supportedApis.includes(contract.api)
      ? contract.api : base?.api;
    const api = config.models.length ? row.api ?? preferredApi : preferredApi ?? row.api;
    if (!api || !(api in apis))
      throw new Error(`Choose a protocol for TokenDance model ${row.id}`);
    if (base && !base.supportedApis.includes(api))
      throw new Error(`${row.id} does not advertise ${api}`);
    return {
      id: row.id,
      name: row.name || base?.name || row.id,
      provider: PROVIDER,
      api,
      baseUrl: row.baseURL || endpoint(config.baseURL, api),
      ...thinking(row.reasoningEfforts ?? (api === contract?.api ? contract.efforts : undefined)),
      input: row.input?.length ? row.input : (base?.input ?? ["text"]),
      contextWindow: row.contextWindow ?? base?.contextWindow ?? 262144,
      maxTokens: row.maxTokens ?? base?.maxTokens ?? 32768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  });
  const piProvider = createProvider({
    id: PROVIDER,
    name: "TokenDance",
    models,
    api: apis,
    auth: {
      apiKey: {
        name: "TokenDance",
        resolve: async ({ credential }) => ({
          auth: { apiKey: credential?.key },
          source: "TokenDance",
        }),
      },
    },
  });
  return {
    provider: PROVIDER,
    displayName: "TokenDance",
    apiKeyEnv: credentialRef(config.apiKeyEnv),
    piProvider,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(
      config.models.flatMap((m) =>
        m.maxTokens ? [[m.id, m.maxTokens] as const] : [],
      ),
    ),
    retryPolicy: resolveRetryPolicy(undefined, "llm-tokendance"),
    streamIdleTimeoutMs: 300000,
    maxRequestImageBytes: 20 * 1024 * 1024,
    requestImagePixelBudget: 2048 * 2048,
    requestImageMaxBytes: 1024 * 1024,
  };
}
export function apply(ctx: Context, config: Config): void {
  let catalog = seed as CatalogModel[];
  let current = () => config;
  let profiles = resolveProfiles(config, catalog);
  const adapter = new TokenDanceAdapter({
    profiles: () => profiles,
    resolveApiKey: async (_provider, profile) => {
      const value = (await ctx.credentials.resolve(profile.apiKeyEnv!))?.value;
      if (!value)
        throw new LlmError(
          "TokenDance API Key is not configured",
          "MISSING_CREDENTIAL",
        );
      return assertUsableApiKey(value, name, profile.apiKeyEnv!);
    },
    // This API-key-only provider has no OAuth records. The authoritative key
    // is always resolved through DSH credentials above, never from this store.
    auth: {
      credentials: new InMemoryCredentialStore(),
      authContext: defaultProviderAuthContext(),
    },
    resolveAttachments: () => ctx.get("attachments"),
  }, (provider, model) => {
    const profile = current().providers[provider];
    if (!profile) return undefined;
    const configured = profile.models.find(row => row.id === model)?.description;
    const description = configured ?? catalog.find(row => row.id === model)?.description;
    return description?.trim() ? description : undefined;
  });
  let mediaSync: (() => void) | undefined;
  let registration: ReturnType<typeof ctx.llm.registerAdapter> | undefined;
  const entries = () => [
    {
      provider: PROVIDER,
      displayName: "TokenDance",
      settingsNs: NS,
      settingsPath: ["providers", PROVIDER],
      declared: profiles.has(PROVIDER),
    },
  ];
  const directory = ctx.llm.registerConfigurableProviders(entries());
  const rebuild = () => {
    profiles = resolveProfiles(current(), catalog);
    const routes = [...profiles.keys()];
    if (registration) registration.replace(routes);
    else if (routes.length)
      registration = ctx.llm.registerAdapter(routes, adapter);
    directory.replace(entries());
    mediaSync?.();
  };
  rebuild();
  const abort = new AbortController();
  ctx.effect(() => () => abort.abort(), "tokendance-catalog");
  async function refresh(signal?: AbortSignal) {
    const requested = current().providers[PROVIDER];
    if (!requested) return [];
    const requestedBase = requested.baseURL;
    const response = await fetch(
      `${endpoint(requestedBase, "openai-completions")}/models`,
      {
        headers: { accept: "application/json", ...attributionHeaders() },
        signal: AbortSignal.any([
          abort.signal,
          AbortSignal.timeout(20000),
          ...(signal ? [signal] : []),
        ]),
      },
    );
    if (!response.ok)
      throw new Error(
        `TokenDance model directory returned HTTP ${response.status}`,
      );
    const next = parseCatalog(await response.json());
    if (!next.length)
      throw new Error("TokenDance returned no supported chat models");
    // Validate before publishing; a failed refresh keeps the last good generation.
    resolveProfile(requested, next);
    if (abort.signal.aborted || current().providers[PROVIDER] !== requested)
      return [];
    catalog = next;
    rebuild();
    return next;
  }
  ctx.llm.registerModelDiscovery(NS, async (_request, signal) =>
    (await refresh(signal)).map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  );
  ctx.settings.installSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {
      rebuild();
      refreshConfigured();
    },
    validate: (next) => {
      resolveProfiles(next, catalog);
    },
  });
  function refreshConfigured() {
    if (!current().providers[PROVIDER]?.refreshCatalog) return;
    void refresh().catch((error) => {
      if (!abort.signal.aborted)
        ctx.logger.warn(
          `TokenDance catalog refresh failed; keeping last known catalog: ${String(error)}`,
        );
    });
  }
  refreshConfigured();
  // Optional service scope disposes registrations when media is unloaded.
  ctx.inject(["amibaMedia"], async mediaCtx => {
    const { TokenDanceMediaProvider } = await import("./media/adapter.js");
    let dispose: (() => void) | undefined;
    const sync = () => {
      dispose?.();
      dispose = undefined;
      if (!current().providers[PROVIDER]) return;
      dispose = mediaCtx.amibaMedia.registerProvider(new TokenDanceMediaProvider(async () => {
        const profile = current().providers[PROVIDER];
        if (!profile) throw new Error("TokenDance is no longer configured");
        const ref = credentialRef(profile.apiKeyEnv);
        const value = (await ctx.credentials.resolve(ref))?.value;
        if (!value) throw new Error("TokenDance API Key is not configured");
        return { baseURL: profile.baseURL, apiKey: assertUsableApiKey(value, name, ref) };
      }));
    };
    sync();
    // Settings lifecycle rebuild calls this after publishing the new profile.
    mediaSync = sync;
    mediaCtx.effect(() => () => { dispose?.(); if (mediaSync === sync) mediaSync = undefined; }, "tokendance-media");
  });
}
