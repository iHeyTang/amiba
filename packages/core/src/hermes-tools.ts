/**
 * Read + toggle client for `/hermes/tools/toolsets` — the agent's
 * configurable toolsets (browser, web search, image gen, …).
 *
 * Backplane wraps `hermes_cli.tools_config`, while targeting the
 * `platform_toolsets.api_server` slot used by Amiba Profile task sessions.
 * Platform-native capabilities retain their Hermes-owned platform scope.
 */

import { backplaneFetch } from "./backplane-client";

function profileUrl(path: string, profileId?: string): string {
  const profile = profileId?.trim();
  if (!profile) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}profile=${encodeURIComponent(profile)}`;
}

export interface HermesToolset {
  /** Stable key — e.g. ``"browser"``, ``"image_gen"``. */
  name: string;
  /** Human-readable label shown in the CLI picker (may contain an emoji). */
  label: string;
  /** Short description of the toolset's scope. */
  description: string;
  /** Currently enabled for the Hermes platform that owns this capability. */
  enabled: boolean;
  /** Same as ``enabled`` today — disabled toolsets aren't registered. */
  available: boolean;
  /** Required API keys / providers are present. */
  configured: boolean;
  /** Concrete tool names this toolset resolves to (sorted). */
  tools: string[];
  /** Hermes platform whose toolset list owns this capability. */
  platform?: string;
  /** Human-readable platform label. */
  platform_label?: string;
}

export interface HermesToolToggleResponse {
  ok: boolean;
  name?: string;
  enabled?: boolean;
  error?: string;
}

/** Per-tool entry inside a toolset detail payload. */
export interface HermesToolItem {
  /** Tool name as the agent sees it (matches the registry key). */
  name: string;
  /** Description registered with the tool — may be empty for shim entries. */
  description: string;
  /** Optional single-character emoji marker the agent uses for log output. */
  emoji: string;
}

/** One row in a provider matrix — surfaces credential/key state. */
export interface HermesToolEnvVar {
  /** Env-var name (e.g. ``OPENAI_API_KEY``). */
  key: string | null;
  /** Prompt label shown to the user when setting the key. */
  prompt: string | null;
  /** Optional reference URL for where to obtain the key. */
  url?: string | null;
  /** Default value the CLI picker pre-fills, if any. */
  default?: string | null;
  /** True when the value is currently set somewhere on the env. */
  is_set: boolean;
  /** False for ordinary connection fields such as a URL, host or user name. */
  secret?: boolean;
}

export interface HermesToolProvider {
  name: string;
  /** Short adornment (e.g. ``free``, ``recommended``) — may be empty. */
  badge: string;
  /** Tag the CLI picker uses for grouping — may be empty. */
  tag: string;
  env_vars: HermesToolEnvVar[];
  /** Identifier for an optional post-install step the CLI runs. */
  post_setup?: string | null;
  /** Provider gates on Nous account auth. */
  requires_nous_auth: boolean;
  /** True when Hermes currently resolves this provider for the capability. */
  is_active: boolean;
  /** Server-computed readiness; never inferred from key count in the UI. */
  status:
    | "ready"
    | "needs_key"
    | "needs_keys"
    | "needs_auth"
    | "needs_setup"
    | "inactive"
    | string;
  /** Web-only backend identifier and supported capability lanes. */
  web_backend?: string | null;
  capabilities?: Array<"search" | "extract" | string>;
  /** Provider keys written into the corresponding Hermes config sections. */
  tts_provider?: string | null;
  browser_provider?: string | null;
  image_gen_plugin_name?: string | null;
  video_gen_plugin_name?: string | null;
}

/** Extended toolset payload returned by GET /hermes/tools/toolsets/{name}. */
export interface HermesToolsetDetail extends HermesToolset {
  /** Per-tool ``{name, description, emoji}`` (parallel to ``tools``). */
  items: HermesToolItem[];
  /** Provider/credential matrix — empty when the toolset has no category. */
  providers: HermesToolProvider[];
  /** True iff the toolset has a ``TOOL_CATEGORIES`` entry. */
  has_category: boolean;
  /** Provider selected by the same resolver the runtime uses. */
  active_provider?: string | null;
  /** Optional guidance authored by Hermes for this capability. */
  setup_title?: string;
  setup_note?: string;
  /** Web uses independent provider choices for search and extraction. */
  active_search_backend?: string | null;
  active_extract_backend?: string | null;
}

export interface HermesToolsetDetailResponse {
  ok: boolean;
  toolset?: HermesToolsetDetail;
  error?: string;
}

export interface HermesToolModel {
  id: string;
  display: string;
  speed: string;
  strengths: string;
  price: string;
}

export interface HermesToolModelsResponse {
  ok: boolean;
  name: string;
  has_models: boolean;
  provider?: string | null;
  plugin?: string | null;
  models: HermesToolModel[];
  current?: string | null;
  default?: string | null;
  error?: string;
}

export interface HermesToolMutationResponse {
  ok: boolean;
  name?: string;
  provider?: string;
  model?: string;
  capability?: string;
  saved?: string[];
  skipped?: string[];
  is_set?: Record<string, boolean>;
  key?: string;
  output?: string;
  error?: string;
}

export interface HermesContextEngine {
  name: string;
  label: string;
  description: string;
  available: boolean;
}

export interface HermesContextEnginesResponse {
  ok: boolean;
  engine: string;
  engines: HermesContextEngine[];
  error?: string;
}

export interface HermesA2APeer {
  name: string;
  url: string;
  timeout: number;
  capabilities: string[];
  auth_type: string;
  /** Bearer token exists, but its value is never returned. */
  auth_configured: boolean;
}

export interface HermesA2APeersResponse {
  ok: boolean;
  peers: HermesA2APeer[];
  error?: string;
}

export interface HermesA2APeerInput {
  url: string;
  timeout: number;
  capabilities: string[];
  /** Write-only; blank/omitted preserves the existing token. */
  token?: string;
  clear_token?: boolean;
}

export interface HermesA2APeerMutationResponse {
  ok: boolean;
  peer?: HermesA2APeer;
  name?: string;
  error?: string;
}

export interface HermesTerminalBackend {
  name: string;
  label: string;
  description: string;
  active: boolean;
  status: "ready" | "needs_setup" | "unavailable" | string;
  detail: string;
  fields: HermesToolEnvVar[];
}

export interface HermesTerminalBackendsResponse {
  ok: boolean;
  active: string;
  backends: HermesTerminalBackend[];
  error?: string;
}

export interface HermesComputerUseCheck {
  label: string;
  status: string;
  message: string;
}

export interface HermesComputerUseStatus {
  ok: boolean;
  platform: string;
  platform_supported: boolean;
  installed: boolean;
  version?: string | null;
  ready?: boolean | null;
  can_grant: boolean;
  accessibility?: boolean | null;
  screen_recording?: boolean | null;
  screen_recording_capturable?: boolean | null;
  checks: HermesComputerUseCheck[];
  error?: string | null;
}

function responseError(
  res: Response,
  data: { error?: string | null } | null | undefined,
): string {
  return (
    (data && typeof data.error === "string" && data.error) ||
    `${res.status} ${res.statusText}`
  );
}

export async function getHermesContextEngines(
  profileId?: string,
): Promise<HermesContextEnginesResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/context-engines", profileId),
      { method: "GET" },
    );
    const data = (await res
      .json()
      .catch(() => null)) as HermesContextEnginesResponse | null;
    if (!res.ok || !data || data.ok === false) {
      return {
        ok: false,
        engine: "compressor",
        engines: [],
        error: responseError(res, data),
      };
    }
    return data;
  } catch (e) {
    return {
      ok: false,
      engine: "compressor",
      engines: [],
      error: String((e as Error)?.message || e),
    };
  }
}

export async function putHermesContextEngine(
  engine: string,
  profileId?: string,
): Promise<HermesToolMutationResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/context-engine", profileId),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine }),
      },
    );
    const data = (await res
      .json()
      .catch(() => null)) as HermesToolMutationResponse | null;
    if (!res.ok || !data || data.ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function getHermesA2APeers(
  profileId?: string,
): Promise<HermesA2APeersResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/a2a/peers", profileId),
      { method: "GET" },
    );
    const data = (await res
      .json()
      .catch(() => null)) as HermesA2APeersResponse | null;
    if (!res.ok || !data || data.ok === false) {
      return { ok: false, peers: [], error: responseError(res, data) };
    }
    return data;
  } catch (e) {
    return { ok: false, peers: [], error: String((e as Error)?.message || e) };
  }
}

export async function putHermesA2APeer(
  name: string,
  input: HermesA2APeerInput,
  profileId?: string,
): Promise<HermesA2APeerMutationResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl(
        `/hermes/tools/a2a/peers/${encodeURIComponent(name)}`,
        profileId,
      ),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const data = (await res
      .json()
      .catch(() => null)) as HermesA2APeerMutationResponse | null;
    if (!res.ok || !data || data.ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function deleteHermesA2APeer(
  name: string,
  profileId?: string,
): Promise<HermesA2APeerMutationResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl(
        `/hermes/tools/a2a/peers/${encodeURIComponent(name)}`,
        profileId,
      ),
      { method: "DELETE" },
    );
    const data = (await res
      .json()
      .catch(() => null)) as HermesA2APeerMutationResponse | null;
    if (!res.ok || !data || data.ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Read terminal execution choices and their server-computed readiness. */
export async function getHermesTerminalBackends(
  profileId?: string,
): Promise<HermesTerminalBackendsResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/terminal/backends", profileId),
      { method: "GET" },
    );
    const data = (await res.json().catch(() => null)) as
      | HermesTerminalBackendsResponse
      | { error?: string }
      | null;
    if (
      !res.ok ||
      !data ||
      (data as HermesTerminalBackendsResponse).ok === false
    ) {
      return {
        ok: false,
        active: "local",
        backends: [],
        error: responseError(res, data),
      };
    }
    return data as HermesTerminalBackendsResponse;
  } catch (e) {
    return {
      ok: false,
      active: "local",
      backends: [],
      error: String((e as Error)?.message || e),
    };
  }
}

/** Select where Hermes executes shell commands and generated code. */
export async function putHermesTerminalBackend(
  backend: string,
  profileId?: string,
): Promise<HermesToolMutationResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/terminal/backend", profileId),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend }),
      },
    );
    const data = (await res.json().catch(() => null)) as
      | HermesToolMutationResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolMutationResponse).ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolMutationResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Save allow-listed credentials/settings for terminal backends. */
export async function putHermesTerminalEnv(
  env: Record<string, string>,
  profileId?: string,
): Promise<HermesToolMutationResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/terminal/env", profileId),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      },
    );
    const data = (await res.json().catch(() => null)) as
      | HermesToolMutationResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolMutationResponse).ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolMutationResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Read cua-driver health and operating-system permission readiness. */
export async function getHermesComputerUseStatus(): Promise<HermesComputerUseStatus> {
  try {
    const res = await backplaneFetch("/hermes/tools/computer-use/status", {
      method: "GET",
    });
    const data = (await res.json().catch(() => null)) as
      | HermesComputerUseStatus
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesComputerUseStatus).ok === false) {
      return {
        ok: false,
        platform: "unknown",
        platform_supported: false,
        installed: false,
        can_grant: false,
        checks: [],
        error: responseError(res, data),
      };
    }
    return data as HermesComputerUseStatus;
  } catch (e) {
    return {
      ok: false,
      platform: "unknown",
      platform_supported: false,
      installed: false,
      can_grant: false,
      checks: [],
      error: String((e as Error)?.message || e),
    };
  }
}

/** Ask Hermes to launch the OS-owned computer-control permission flow. */
export async function postHermesComputerUseGrant(): Promise<HermesToolMutationResponse> {
  try {
    const res = await backplaneFetch(
      "/hermes/tools/computer-use/permissions/grant",
      { method: "POST" },
    );
    const data = (await res.json().catch(() => null)) as
      | HermesToolMutationResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolMutationResponse).ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolMutationResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** GET /hermes/tools/toolsets — full list with state per item. */
export async function getHermesToolsets(profileId?: string): Promise<{
  ok: boolean;
  toolsets: HermesToolset[];
  error?: string;
}> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/toolsets", profileId),
      { method: "GET" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, toolsets: [], error: responseError(res, body) };
    }
    const data = (await res.json()) as HermesToolset[];
    return { ok: true, toolsets: Array.isArray(data) ? data : [] };
  } catch (e) {
    return {
      ok: false,
      toolsets: [],
      error: String((e as Error)?.message || e),
    };
  }
}

/** GET /hermes/tools/toolsets/{name} — extended detail for one toolset. */
export async function getHermesToolsetDetail(
  name: string,
  profileId?: string,
): Promise<HermesToolsetDetailResponse> {
  try {
    const url = profileUrl(
      `/hermes/tools/toolsets/${encodeURIComponent(name)}`,
      profileId,
    );
    const res = await backplaneFetch(url, { method: "GET" });
    const data = (await res.json().catch(() => null)) as
      | HermesToolsetDetailResponse
      | { error?: string }
      | null;
    if (!res.ok || (data as HermesToolsetDetailResponse)?.ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolsetDetailResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Select the provider Hermes should use for a capability. */
export async function putHermesToolsetProvider(
  name: string,
  provider: string,
  capability?: "search" | "extract",
  profileId?: string,
): Promise<HermesToolMutationResponse> {
  try {
    const url = profileUrl(
      `/hermes/tools/toolsets/${encodeURIComponent(name)}/provider`,
      profileId,
    );
    const res = await backplaneFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        ...(capability ? { capability } : {}),
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | HermesToolMutationResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolMutationResponse).ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolMutationResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/**
 * Save only provider fields declared by Hermes for this capability.
 * Existing secrets are never returned by the API; blank values are ignored.
 */
export async function putHermesToolsetEnv(
  name: string,
  env: Record<string, string>,
  profileId?: string,
): Promise<HermesToolMutationResponse> {
  try {
    const url = profileUrl(
      `/hermes/tools/toolsets/${encodeURIComponent(name)}/env`,
      profileId,
    );
    const res = await backplaneFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env }),
    });
    const data = (await res.json().catch(() => null)) as
      | HermesToolMutationResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolMutationResponse).ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolMutationResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Read a provider-specific image/video generation model catalog. */
export async function getHermesToolsetModels(
  name: string,
  provider?: string,
  profileId?: string,
): Promise<HermesToolModelsResponse> {
  try {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    const url = profileUrl(
      `/hermes/tools/toolsets/${encodeURIComponent(name)}/models${query}`,
      profileId,
    );
    const res = await backplaneFetch(url, { method: "GET" });
    const data = (await res.json().catch(() => null)) as
      | HermesToolModelsResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolModelsResponse).ok === false) {
      return {
        ok: false,
        name,
        has_models: false,
        models: [],
        error: responseError(res, data),
      };
    }
    return data as HermesToolModelsResponse;
  } catch (e) {
    return {
      ok: false,
      name,
      has_models: false,
      models: [],
      error: String((e as Error)?.message || e),
    };
  }
}

/** Persist a validated provider model choice. */
export async function putHermesToolsetModel(
  name: string,
  model: string,
  provider?: string,
  profileId?: string,
): Promise<HermesToolMutationResponse> {
  try {
    const url = profileUrl(
      `/hermes/tools/toolsets/${encodeURIComponent(name)}/model`,
      profileId,
    );
    const res = await backplaneFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, ...(provider ? { provider } : {}) }),
    });
    const data = (await res.json().catch(() => null)) as
      | HermesToolMutationResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolMutationResponse).ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolMutationResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

/** Run a provider-declared installer or OAuth/setup helper. */
export async function postHermesToolsetSetup(
  name: string,
  key: string,
  profileId?: string,
): Promise<HermesToolMutationResponse> {
  try {
    const url = profileUrl(
      `/hermes/tools/toolsets/${encodeURIComponent(name)}/post-setup`,
      profileId,
    );
    const res = await backplaneFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = (await res.json().catch(() => null)) as
      | HermesToolMutationResponse
      | { error?: string }
      | null;
    if (!res.ok || !data || (data as HermesToolMutationResponse).ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return data as HermesToolMutationResponse;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

// ---------------------------------------------------------------------------
// Installed MCP servers (from config.yaml/mcp_servers)
// ---------------------------------------------------------------------------

export interface HermesInstalledMcp {
  /** Key under ``mcp_servers`` in ``config.yaml``. */
  slug: string;
  /** Display label — same as ``slug`` today (the saved record has no label). */
  label: string;
  /** Free-form description from the saved record (often empty). */
  description: string;
  /** "curated" when the slug matches an entry in optional-mcps/, else "manual". */
  source: "curated" | "manual";
  /** Always true for this endpoint — kept for shape parity with marketplace items. */
  installed: true;
  /** Per-server enabled flag (tolerant truthy parse, defaults true). */
  enabled: boolean;
  /** "stdio" | "http" | "" when we can't tell from the saved record. */
  transport_kind: string;
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env_keys?: string[];
  header_keys?: string[];
}

export interface HermesMcpInput {
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  description?: string;
  enabled?: boolean;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface HermesMcpMutationResponse {
  ok: boolean;
  error?: string;
  tools?: Array<{ name: string; description: string }>;
  prompts?: number;
  resources?: number;
}

async function mutateMcp(
  slug: string,
  method: "PUT" | "DELETE" | "POST",
  profileId?: string,
  input?: HermesMcpInput,
  suffix = "",
): Promise<HermesMcpMutationResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl(
        `/hermes/tools/installed-mcps/${encodeURIComponent(slug)}${suffix}`,
        profileId,
      ),
      {
        method,
        headers: { "Content-Type": "application/json" },
        body: input ? JSON.stringify(input) : undefined,
      },
    );
    const data = (await res
      .json()
      .catch(() => null)) as HermesMcpMutationResponse | null;
    if (!res.ok || !data?.ok)
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return data;
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export function saveHermesMcp(
  slug: string,
  input: HermesMcpInput,
  profileId?: string,
) {
  return mutateMcp(slug, "PUT", profileId, input);
}

export function removeHermesMcp(slug: string, profileId?: string) {
  return mutateMcp(slug, "DELETE", profileId);
}

export function testHermesMcp(slug: string, profileId?: string) {
  return mutateMcp(slug, "POST", profileId, undefined, "/test");
}

export interface HermesInstalledMcpsResponse {
  ok: boolean;
  items: HermesInstalledMcp[];
  error?: string;
}

/** GET /hermes/tools/installed-mcps — user-installed MCP servers. */
export async function getHermesInstalledMcps(
  profileId?: string,
): Promise<HermesInstalledMcpsResponse> {
  try {
    const res = await backplaneFetch(
      profileUrl("/hermes/tools/installed-mcps", profileId),
      { method: "GET" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, items: [], error: responseError(res, body) };
    }
    const data = (await res.json()) as HermesInstalledMcpsResponse;
    return { ok: true, items: Array.isArray(data.items) ? data.items : [] };
  } catch (e) {
    return { ok: false, items: [], error: String((e as Error)?.message || e) };
  }
}

/**
 * PUT /hermes/tools/toolsets/{name} — flip the enabled flag.
 *
 * Mirrors upstream PUT /api/tools/toolsets/{name}. Persists to the selected
 * Profile's owning configuration surface, so the change takes effect on the
 * next agent session.
 */
export async function putHermesToolsetToggle(
  name: string,
  enabled: boolean,
  profileId?: string,
): Promise<HermesToolToggleResponse> {
  try {
    const url = profileUrl(
      `/hermes/tools/toolsets/${encodeURIComponent(name)}`,
      profileId,
    );
    const res = await backplaneFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = (await res.json()) as HermesToolToggleResponse;
    if (!res.ok || data.ok === false) {
      return { ok: false, error: responseError(res, data) };
    }
    return { ok: true, name: data.name, enabled: data.enabled };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}
