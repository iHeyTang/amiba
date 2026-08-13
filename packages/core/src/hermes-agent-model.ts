/**
 * Low-level Hermes model transport adapter.
 *
 * Three orthogonal surfaces — no bundling, no aliases:
 *
 *   - ``/hermes/model/info``         main-model state
 *   - ``/hermes/model/set``          main + auxiliary writes
 *   - ``/hermes/model/options``      provider catalog
 *   - ``/hermes/model/moa``          virtual MoA capability configuration
 *   - ``/hermes/provider-models``    per-provider model list
 *   - ``/hermes/provider-credentials`` plugin .env credentials only
 *
 * UI code should consume ``hermesModelGateway`` from
 * ``./hermes-model-gateway``. This module is intentionally limited to HTTP
 * protocol adaptation and wire normalization so display policy cannot spread
 * across individual screens.
 */

import { backplaneFetch } from "./backplane-client";

/**
 * Capability fields explicitly published by Hermes's ``/api/model/info``.
 * Hermes currently resolves some values through its model registry, but that
 * is an upstream implementation detail: Amiba treats the endpoint response as
 * the Hermes contract. All fields remain optional because absence means
 * "unknown", not "unsupported".
 */
export interface HermesModelCapabilities {
  supports_tools?: boolean;
  supports_vision?: boolean;
  supports_reasoning?: boolean;
  context_window?: number | null;
  max_output_tokens?: number | null;
  model_family?: string | null;
}

export interface HermesAgentMainModelResponse {
  ok: boolean;
  provider?: string;
  model?: string;
  /** Resolved ``model.base_url`` from ``config.yaml`` (null when unset). */
  base_url?: string | null;
  auto_context_length?: number;
  config_context_length?: number;
  effective_context_length?: number;
  capabilities?: HermesModelCapabilities;
  error?: string;
}

export interface HermesCatalogModelEntry {
  id: string;
  /** Name or description supplied directly by the provider/Hermes. */
  description?: string;
  /** Capability/specification fields supplied directly by the provider/Hermes. */
  metadata?: Record<string, unknown>;
  /**
   * Optional third-party catalog information. It stays separate from
   * `metadata` so provenance is preserved. Consumers may derive an allowlisted
   * preview from both sources, but provider/Hermes metadata wins conflicts.
   */
  supplemental?: {
    source: string;
    description?: string;
    metadata: Record<string, unknown>;
  };
}

export interface HermesCatalogProviderBlock {
  metadata?: Record<string, unknown>;
  models: HermesCatalogModelEntry[];
  /** Stock base URL the provider ships with — purely informational. */
  default_base_url?: string;
  /** Upstream inventory provenance, for example `user-config` or `virtual`. */
  source?: string;
  /** Upstream authentication/launch mechanism, including `virtual`. */
  auth_type?: string;
  authenticated?: boolean;
  /** Profile-aware effective credential source reported by Amiba's backplane. */
  connection?: HermesProviderConnection;
  credential_scope?: HermesProviderCredentialScope;
  warning?: string;
}

/** Same entries as `hermes model` TUI (`hermes_cli.models.CANONICAL_PROVIDERS`). */
export interface HermesCanonicalProviderEntry {
  slug: string;
  label: string;
  tui_desc: string;
}

export interface HermesModelCatalogResponse {
  ok: boolean;
  error?: string;
  catalog_source?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
  providers?: Record<string, HermesCatalogProviderBlock>;
  provider_ids?: string[];
  config_provider_ids?: string[];
  env_ready_provider_ids?: string[];
  /** Providers Hermes can currently authenticate, including ambient OAuth/SDK credentials. */
  authenticated_provider_ids?: string[];
  canonical_providers?: HermesCanonicalProviderEntry[];
  canonical_loaded?: boolean;
  provider_env_vars?: Record<string, string[]>;
  warning?: string;
}

/**
 * One editable env var on a provider's credentials panel.
 *
 * Secret fields are editable connection methods; URL fields are shared
 * endpoint settings. Provider-specific URL resolution is represented by
 * ``HermesProviderEndpointResolution`` so clients never infer runtime
 * precedence from placeholders or field order.
 */
export interface HermesProviderCredentialField {
  /** Env var name. */
  key: string;
  /**
   * Editable value read from the local saved/runtime environment. Clients
   * render secret fields as masked password inputs.
   */
  value: string;
  /**
   * Placeholder shown when the input is empty. Carries the provider's
   * default endpoint for URL fields; empty for secret fields.
   */
  placeholder: string;
  /** ``"url"`` or ``"secret"`` — UI hint for input type/styling. */
  kind: "url" | "secret";
  /** Where the current value was found. */
  origin?: "saved" | "environment" | "none";
  /** Whether either a saved or ambient value exists for this field. */
  configured?: boolean;
}

/** Canonical endpoint resolution reported by the runtime settings boundary. */
export interface HermesProviderEndpointResolution {
  /** Stock URL from Hermes's runtime provider registry. */
  default_base_url: string;
  /** Provider-specific env var used for an optional override. */
  override_env_var: string;
  /** Saved or ambient override, empty when the default is active. */
  override_base_url: string;
  /** URL Hermes will use after provider-specific resolution. */
  effective_base_url: string;
  source: "saved" | "environment" | "default" | "none";
}

export type HermesProviderConnectionStatus =
  | "none"
  | "detected"
  | "configured"
  | "verification_required"
  | "verified"
  | "unavailable";

export type HermesProviderConnectionMethodStatus =
  | "none"
  | "detected"
  | "configured"
  | "active";

export type HermesProviderServiceStatus =
  | "not_applicable"
  | "not_checked"
  | "verified"
  | "unavailable";

export type HermesProviderCredentialScope =
  | "profile"
  | "shared"
  | "system"
  | "none";

export interface HermesProviderConnectionMethod {
  id: string;
  kind: "api_key" | "oauth_token" | "oauth" | "external_cli" | "external";
  source: string;
  field_key: string;
  configured: boolean;
  detected: boolean;
  editable: boolean;
  status: HermesProviderConnectionMethodStatus;
  /** Ownership of this method relative to the selected Profile. */
  scope?: HermesProviderCredentialScope;
  /** Optional user-facing label attached to a Hermes credential-pool entry. */
  label?: string;
  /** Hermes pool priority when the method comes from auth.json. */
  priority?: number;
}

export interface HermesProviderConnection {
  status: HermesProviderConnectionStatus;
  active_method: string;
  active_scope?: HermesProviderCredentialScope;
  methods: HermesProviderConnectionMethod[];
  service: {
    status: HermesProviderServiceStatus;
    reason: string;
  };
}

/** ``GET /hermes/provider-credentials?provider=…`` response. */
export interface HermesProviderCredentialsResponse {
  ok: boolean;
  error?: string;
  provider: string;
  fields: HermesProviderCredentialField[];
  /** Unified default/override/effective endpoint resolution for this provider. */
  endpoint?: HermesProviderEndpointResolution;
  /** External/OAuth authentication hint, when the provider supports one. */
  auth_hint: string;
  auth_type?: string;
  connection?: HermesProviderConnection;
  /** Profile whose .env is being read or written. */
  profile?: string;
  written?: string[];
  /** Hermes command result after the saved credentials restart Gateway. */
  gateway_restart?: {
    ok: boolean;
    name: "gateway-restart";
    mode?: "unchanged";
    command_pid?: number;
    previous_gateway_pid?: number | null;
    gateway_pid?: number;
    gateway_state?: string;
  };
}

export interface HermesOAuthSession {
  ok: boolean;
  error?: string;
  session_id?: string;
  provider?: string;
  running?: boolean;
  exit_code?: number | null;
  output?: string;
  started_at?: number;
}

async function oauthRequest(
  path: string,
  init: RequestInit,
  profileId?: string,
): Promise<HermesOAuthSession> {
  try {
    const response = await backplaneFetch(profileUrl(path, profileId), init);
    const data = (await response
      .json()
      .catch(() => null)) as HermesOAuthSession | null;
    if (!response.ok || data?.ok === false)
      return { ok: false, error: data?.error || `HTTP ${response.status}` };
    return { ...(data ?? {}), ok: true };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}

export function startHermesOAuth(provider: string, profileId?: string) {
  return oauthRequest(
    `/hermes/providers/oauth/${encodeURIComponent(provider)}/start`,
    { method: "POST" },
    profileId,
  );
}

export function getHermesOAuthSession(sessionId: string, profileId?: string) {
  return oauthRequest(
    `/hermes/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
    { method: "GET" },
    profileId,
  );
}

export function sendHermesOAuthInput(
  sessionId: string,
  input: string,
  profileId?: string,
) {
  return oauthRequest(
    `/hermes/providers/oauth/sessions/${encodeURIComponent(sessionId)}/input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    },
    profileId,
  );
}

export function cancelHermesOAuth(sessionId: string, profileId?: string) {
  return oauthRequest(
    `/hermes/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
    profileId,
  );
}

export interface HermesCredentialPoolEntry {
  index: number;
  id?: string;
  label?: string;
  auth_type?: string;
  source?: string;
  priority: number;
  last_status?: string | null;
  request_count: number;
  token_preview: string;
  has_refresh: boolean;
}

export async function getHermesCredentialPool(
  provider: string,
  profileId?: string,
): Promise<{
  ok: boolean;
  entries: HermesCredentialPoolEntry[];
  error?: string;
}> {
  try {
    const response = await backplaneFetch(
      profileUrl(
        `/hermes/credentials/pool?provider=${encodeURIComponent(provider)}`,
        profileId,
      ),
    );
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      providers?: Array<{
        provider: string;
        entries: HermesCredentialPoolEntry[];
      }>;
      error?: string;
    } | null;
    if (!response.ok || data?.ok === false)
      return {
        ok: false,
        entries: [],
        error: data?.error || `HTTP ${response.status}`,
      };
    return {
      ok: true,
      entries:
        data?.providers?.find((item) => item.provider === provider)?.entries ??
        [],
    };
  } catch (error) {
    return {
      ok: false,
      entries: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function addHermesCredentialPoolEntry(
  provider: string,
  apiKey: string,
  label: string,
  profileId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await oauthRequest(
    "/hermes/credentials/pool",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, api_key: apiKey, label }),
    },
    profileId,
  );
  return { ok: result.ok, error: result.error };
}

export async function removeHermesCredentialPoolEntry(
  provider: string,
  index: number,
  profileId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await oauthRequest(
    `/hermes/credentials/pool/${encodeURIComponent(provider)}/${index}`,
    { method: "DELETE" },
    profileId,
  );
  return { ok: result.ok, error: result.error };
}

/** Per-provider model list resolved from `/hermes/provider-models`. */
export interface HermesProviderModelsResponse {
  ok: boolean;
  error?: string;
  provider?: string;
  models?: HermesCatalogModelEntry[];
  source?: string;
  cli_loaded?: boolean;
  pricing_loaded?: boolean;
}

export interface HermesMoaModelSlot {
  provider: string;
  model: string;
  enabled?: boolean;
  reasoning_effort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max"
    | "ultra";
  /** Optional reference-only output cap. Overrides the preset-level cap. */
  max_tokens?: number;
}

export interface HermesMoaPreset {
  reference_models: HermesMoaModelSlot[];
  aggregator: HermesMoaModelSlot;
  /** Null means Hermes leaves temperature unset and uses the provider default. */
  reference_temperature: number | null;
  /** Null means Hermes leaves temperature unset and uses the provider default. */
  aggregator_temperature: number | null;
  reference_timeout?: number | null;
  degraded_reference_policy?: "loud" | "silent";
  max_tokens: number;
  reference_max_tokens?: number | null;
  fanout?: "user_turn" | "per_iteration" | `every_n:${number}`;
  enabled: boolean;
}

/**
 * Upstream-aligned `/api/model/moa` response.
 *
 * The flat fields are retained because Hermes deliberately includes them for
 * older clients; new Amiba code edits the named `presets` map.
 */
export interface HermesMoaConfigResponse {
  ok: boolean;
  error?: string;
  configured?: boolean;
  default_preset: string;
  active_preset: string;
  presets: Record<string, HermesMoaPreset>;
  reference_models: HermesMoaModelSlot[];
  aggregator: HermesMoaModelSlot;
  reference_temperature: number | null;
  aggregator_temperature: number | null;
  reference_timeout?: number | null;
  degraded_reference_policy?: "loud" | "silent";
  max_tokens: number;
  reference_max_tokens?: number | null;
  fanout?: "user_turn" | "per_iteration" | `every_n:${number}`;
  enabled: boolean;
  privacy_filter?: "" | "display" | "full";
  save_traces?: boolean;
  trace_dir?: string;
}

function responseError(
  res: Response,
  data: { error?: string } | null | undefined,
): string {
  return (
    (data && typeof data.error === "string" && data.error) ||
    `${res.status} ${res.statusText}`
  );
}

function profileUrl(path: string, profileId?: string): string {
  const profile = profileId?.trim();
  if (!profile) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}profile=${encodeURIComponent(profile)}`;
}

/** Read the main model's resolved state from ``config.yaml``. */
export async function getHermesMainModelInfo(
  profileId?: string,
): Promise<HermesAgentMainModelResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl(`/hermes/model/info`, profileId),
      { method: "GET" },
    );
    const data = (await res.json()) as HermesAgentMainModelResponse;
    if (!res.ok) {
      return { ok: false, error: responseError(res, data) };
    }
    return { ...data, ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Set the main model. ``base_url`` is optional: pass ``null`` to clear. */
export async function setHermesAgentMainModel(
  patch: {
    provider: string;
    model: string;
    base_url?: string | null;
  },
  profileId?: string,
): Promise<HermesAgentMainModelResponse> {
  const body: Record<string, unknown> = {
    scope: "main",
    provider: patch.provider,
    model: patch.model,
  };
  if (Object.prototype.hasOwnProperty.call(patch, "base_url")) {
    body.base_url = patch.base_url;
  }
  try {
    const res = await backplaneFetch(
      profileUrl(`/hermes/model/set`, profileId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = (await res.json()) as HermesAgentMainModelResponse;
    if (!res.ok) {
      return { ok: false, error: responseError(res, data) };
    }
    return { ...data, ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Read plugin .env credentials for one provider. */
export async function getHermesProviderCredentials(
  provider: string,
  verify = true,
  profileId?: string,
): Promise<HermesProviderCredentialsResponse> {
  const slug = provider.trim();
  if (!slug) {
    return {
      ok: false,
      error: "provider required",
      provider: "",
      fields: [],
      auth_hint: "",
    };
  }
  try {
    const res = await backplaneFetch(
      profileUrl(
        `/hermes/provider-credentials?provider=${encodeURIComponent(slug)}${verify ? "&verify=1" : ""}`,
        profileId,
      ),
      { method: "GET" },
    );
    const data = (await res.json()) as HermesProviderCredentialsResponse;
    if (!res.ok) {
      return {
        ok: false,
        error: responseError(res, data),
        provider: slug,
        fields: [],
        auth_hint: "",
      };
    }
    return {
      ok: true,
      provider: data.provider ?? slug,
      fields: Array.isArray(data.fields) ? data.fields : [],
      auth_hint: typeof data.auth_hint === "string" ? data.auth_hint : "",
      auth_type:
        typeof data.auth_type === "string" ? data.auth_type : undefined,
      connection:
        data.connection && typeof data.connection === "object"
          ? data.connection
          : undefined,
      endpoint:
        data.endpoint && typeof data.endpoint === "object"
          ? data.endpoint
          : undefined,
      profile: typeof data.profile === "string" ? data.profile : profileId,
    };
  } catch (e) {
    return {
      ok: false,
      error: String((e as Error)?.message || e),
      provider: slug,
      fields: [],
      auth_hint: "",
    };
  }
}

/** Write plugin .env credentials for one provider. */
export async function saveHermesProviderCredentials(
  provider: string,
  values: Record<string, string>,
  profileId?: string,
): Promise<HermesProviderCredentialsResponse> {
  const slug = provider.trim();
  if (!slug) {
    return {
      ok: false,
      error: "provider required",
      provider: "",
      fields: [],
      auth_hint: "",
    };
  }
  try {
    const res = await backplaneFetch(
      profileUrl(`/hermes/provider-credentials`, profileId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: slug, values }),
      },
    );
    const data = (await res.json()) as HermesProviderCredentialsResponse;
    if (!res.ok) {
      return {
        ok: false,
        error: responseError(res, data),
        provider: slug,
        fields: [],
        auth_hint: "",
      };
    }
    return {
      ok: true,
      provider: data.provider ?? slug,
      fields: Array.isArray(data.fields) ? data.fields : [],
      auth_hint: typeof data.auth_hint === "string" ? data.auth_hint : "",
      auth_type:
        typeof data.auth_type === "string" ? data.auth_type : undefined,
      connection:
        data.connection && typeof data.connection === "object"
          ? data.connection
          : undefined,
      endpoint:
        data.endpoint && typeof data.endpoint === "object"
          ? data.endpoint
          : undefined,
      written: data.written ?? [],
      profile: typeof data.profile === "string" ? data.profile : profileId,
      gateway_restart:
        data.gateway_restart && typeof data.gateway_restart === "object"
          ? data.gateway_restart
          : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      error: String((e as Error)?.message || e),
      provider: slug,
      fields: [],
      auth_hint: "",
    };
  }
}

/**
 * Wire row as emitted by Hermes's ``inventory.build_models_payload``
 * with ``picker_hints=True`` (what backplane requests). Source values:
 *
 * - ``"user-config"``: explicit ``providers.<name>`` entry in
 *   ``~/.hermes/config.yaml``
 * - ``"built-in"`` / ``"hermes"``: Hermes detected the provider from
 *   a built-in catalog (curated model list) — does NOT necessarily
 *   mean the user authenticated it; could just be visible because
 *   Hermes ships with the slug registered
 * - ``"canonical"``: skeleton placeholder for an unconfigured
 *   provider (only present when ``include_unconfigured=True``)
 *
 * ``authenticated``: true when the row has usable credentials;
 * false for skeleton placeholders. ``is_user_defined``: true for
 * custom-endpoint config entries.
 */
interface WireProviderRow {
  slug: string;
  name?: string;
  is_current?: boolean;
  is_user_defined?: boolean;
  /**
   * Upstream's ``build_models_payload`` ships ``models`` as a plain
   * ``string[]`` of model ids — NOT the ``{id, description, metadata}``
   * objects the rest of this module is typed against. We normalize at
   * the adapter boundary (see ``adaptModelOptions``) so consumers
   * always see ``HermesCatalogModelEntry[]``. Older endpoints / dev
   * fallbacks may still send object form, so accept both here.
   */
  models?: (HermesCatalogModelEntry | string)[];
  total_models?: number;
  source?: string;
  authenticated?: boolean;
  auth_type?: string;
  key_env?: string;
  default_base_url?: string;
  connection?: HermesProviderConnection;
  credential_scope?: HermesProviderCredentialScope;
  warning?: string;
}

interface WireModelOptionsResponse {
  providers?: WireProviderRow[];
  model?: string;
  provider?: string;
  /** Canonical (alias-resolved) slugs the user wrote in ``config.yaml: providers:``. */
  configured_provider_slugs?: string[];
  /** Slugs whose API key env vars have non-empty values in the plugin ``.env``. */
  dotenv_configured_provider_slugs?: string[];
  error?: string;
}

function adaptModelOptions(
  wire: WireModelOptionsResponse,
): HermesModelCatalogResponse {
  const rows = Array.isArray(wire.providers) ? wire.providers : [];
  const configuredFromBackplane = new Set<string>(
    Array.isArray(wire.configured_provider_slugs)
      ? wire.configured_provider_slugs.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [],
  );
  const dotenvConfiguredSlugs = new Set<string>(
    Array.isArray(wire.dotenv_configured_provider_slugs)
      ? wire.dotenv_configured_provider_slugs.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [],
  );
  const providersDict: Record<string, HermesCatalogProviderBlock> = {};
  const providerIds: string[] = [];
  const configProviderIds: string[] = [];
  const envReadyProviderIds: string[] = [];
  const authenticatedProviderIds: string[] = [];
  const canonical: HermesCanonicalProviderEntry[] = [];
  for (const r of rows) {
    const slug = (r.slug || "").trim();
    if (!slug) continue;
    providerIds.push(slug);
    // Normalize ``models`` to ``HermesCatalogModelEntry[]`` regardless
    // of wire shape (upstream sends string[], legacy / fallback may
    // send object[]). Downstream code reads ``m.id`` everywhere.
    const normalizedModels: HermesCatalogModelEntry[] = [];
    for (const m of r.models ?? []) {
      if (typeof m === "string") {
        const id = m.trim();
        if (id) normalizedModels.push({ id });
      } else if (m && typeof m === "object" && typeof m.id === "string") {
        const id = m.id.trim();
        if (id) normalizedModels.push(m);
      }
    }
    providersDict[slug] = {
      models: normalizedModels,
      default_base_url: r.default_base_url ?? "",
      source: r.source,
      auth_type: r.auth_type,
      authenticated: r.authenticated,
      connection: r.connection,
      credential_scope: r.credential_scope,
      warning: typeof r.warning === "string" ? r.warning : undefined,
    } as HermesCatalogProviderBlock;
    if (r.authenticated === true) {
      authenticatedProviderIds.push(slug);
    }
    const isUserConfigured =
      configuredFromBackplane.has(slug) ||
      r.source === "user-config" ||
      r.is_user_defined === true;
    if (isUserConfigured) {
      configProviderIds.push(slug);
    } else if (dotenvConfiguredSlugs.has(slug)) {
      // Strict signal: the user pressed "Save credentials" in this
      // extension and the plugin ``.env`` now carries this provider's
      // API key. ``r.authenticated`` is deliberately NOT enough — it
      // also fires when Hermes detects ambient credentials elsewhere
      // (shell env vars, Claude Code OAuth at ``~/.claude``, ``gh``
      // CLI tokens, AWS SDK config, …). Those flag a provider as
      // "usable" but not "configured here", and lumping them under
      // "Configured" surprises users who never touched the panel.
      envReadyProviderIds.push(slug);
    }
    canonical.push({
      slug,
      label: r.name || slug,
      tui_desc: r.name || slug,
    });
  }
  return {
    ok: true,
    providers: providersDict,
    provider_ids: providerIds,
    config_provider_ids: configProviderIds,
    env_ready_provider_ids: envReadyProviderIds,
    authenticated_provider_ids: authenticatedProviderIds,
    canonical_providers: canonical,
    canonical_loaded: true,
  };
}

export async function getHermesModelCatalog(
  refresh = false,
  profileId?: string,
): Promise<HermesModelCatalogResponse> {
  const q = refresh ? "?refresh=1" : "";
  try {
    const url = profileUrl(`/hermes/model/options${q}`, profileId);
    const res = await backplaneFetch(url, { method: "GET" });
    const data = (await res.json()) as WireModelOptionsResponse;
    if (!res.ok) {
      return {
        ok: false,
        error: responseError(res, data),
      };
    }
    return adaptModelOptions(data);
  } catch (e) {
    return {
      ok: false,
      error: String((e as Error)?.message || e),
    };
  }
}

/** Auxiliary task slot names — matches upstream `AUXILIARY_SLOTS`. */
export const AUXILIARY_SLOT_NAMES = [
  "vision",
  "web_extract",
  "compression",
  "session_search",
  "skills_hub",
  "approval",
  "mcp",
  "title_generation",
] as const;

export type AuxiliarySlotName = (typeof AUXILIARY_SLOT_NAMES)[number];

export const AUXILIARY_SLOT_LABELS: Record<AuxiliarySlotName, string> = {
  vision: "Vision",
  web_extract: "Web Extract",
  compression: "Compression",
  session_search: "Session Search",
  skills_hub: "Skills Hub",
  approval: "Approval",
  mcp: "MCP",
  title_generation: "Title Generation",
};

/** One row in the auxiliary-task list. */
export interface AuxiliaryTask {
  task: AuxiliarySlotName;
  provider: string;
  model: string;
  base_url: string;
}

export interface AuxiliaryMainModelSummary {
  provider: string;
  model: string;
}

export interface AuxiliaryModelsResponse {
  ok: boolean;
  error?: string;
  tasks?: AuxiliaryTask[];
  main?: AuxiliaryMainModelSummary;
}

export async function getHermesAuxiliaryModels(
  profileId?: string,
): Promise<AuxiliaryModelsResponse> {
  try {
    const url = profileUrl(`/hermes/model/auxiliary`, profileId);
    const res = await backplaneFetch(url, { method: "GET" });
    const data = (await res.json()) as AuxiliaryModelsResponse;
    if (!res.ok) {
      return { ok: false, error: responseError(res, data) };
    }
    return { ...data, ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function setHermesAuxiliarySlot(
  patch: {
    task: AuxiliarySlotName;
    provider?: string;
    model?: string;
  },
  profileId?: string,
): Promise<AuxiliaryModelsResponse> {
  try {
    const setUrl = profileUrl(`/hermes/model/set`, profileId);
    const setRes = await backplaneFetch(setUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "auxiliary", ...patch }),
    });
    if (!setRes.ok) {
      const data = (await setRes.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, error: responseError(setRes, data) };
    }
    return await getHermesAuxiliaryModels(profileId);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

function emptyMoaResponse(error?: string): HermesMoaConfigResponse {
  return {
    ok: false,
    error,
    configured: false,
    default_preset: "",
    active_preset: "",
    presets: {},
    reference_models: [],
    aggregator: { provider: "", model: "" },
    reference_temperature: null,
    aggregator_temperature: null,
    reference_timeout: null,
    degraded_reference_policy: "loud",
    max_tokens: 4096,
    reference_max_tokens: null,
    fanout: "user_turn",
    enabled: false,
    privacy_filter: "",
    save_traces: false,
    trace_dir: "",
  };
}

/** Read Hermes's named Mixture-of-Agents presets. */
export async function getHermesMoaConfig(
  profileId?: string,
): Promise<HermesMoaConfigResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl(`/hermes/model/moa`, profileId),
      { method: "GET" },
    );
    const data = (await res.json()) as HermesMoaConfigResponse;
    if (!res.ok || data.ok === false) {
      return emptyMoaResponse(responseError(res, data));
    }
    return { ...data, ok: true };
  } catch (e) {
    return emptyMoaResponse(String((e as Error)?.message || e));
  }
}

/** Persist the complete named-preset map through Hermes's MoA config surface. */
export async function saveHermesMoaConfig(
  config: Pick<
    HermesMoaConfigResponse,
    "default_preset" | "active_preset" | "presets" | "privacy_filter"
  >,
  profileId?: string,
): Promise<HermesMoaConfigResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl(`/hermes/model/moa`, profileId),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_preset: config.default_preset,
          active_preset: config.active_preset,
          presets: config.presets,
          privacy_filter: config.privacy_filter,
        }),
      },
    );
    const data = (await res.json()) as HermesMoaConfigResponse;
    if (!res.ok || data.ok === false) {
      return emptyMoaResponse(responseError(res, data));
    }
    return { ...data, ok: true };
  } catch (e) {
    return emptyMoaResponse(String((e as Error)?.message || e));
  }
}

export async function getHermesProviderModels(
  provider: string,
  refresh = false,
  profileId?: string,
): Promise<HermesProviderModelsResponse> {
  const providerId = provider.trim();
  try {
    const p = encodeURIComponent(providerId);
    const q = refresh ? "&refresh=1" : "";
    const url = profileUrl(
      `/hermes/provider-models?provider=${p}${q}`,
      profileId,
    );
    const res = await backplaneFetch(url, { method: "GET" });
    const data = (await res.json()) as HermesProviderModelsResponse;
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        error: responseError(res, data),
      };
    }
    return { ...data, ok: true };
  } catch (e) {
    return {
      ok: false,
      error: String((e as Error)?.message || e),
    };
  }
}
