/**
 * Read + toggle client for `/hermes/tools/toolsets` — the agent's
 * configurable toolsets (browser, web search, image gen, …).
 *
 * Backplane wraps `hermes_cli.tools_config`, the same module the CLI
 * `hermes tools` picker uses, so toggling here lands in the same
 * `platform_toolsets.cli` slot of `config.yaml`.
 */

import { backplaneFetch } from "./backplane-client";

export interface HermesToolset {
  /** Stable key — e.g. ``"browser"``, ``"image_gen"``. */
  name: string;
  /** Human-readable label shown in the CLI picker (may contain an emoji). */
  label: string;
  /** Short description of the toolset's scope. */
  description: string;
  /** Currently enabled in ``config.yaml/platform_toolsets.cli``. */
  enabled: boolean;
  /** Same as ``enabled`` today — disabled toolsets aren't registered. */
  available: boolean;
  /** Required API keys / providers are present. */
  configured: boolean;
  /** Concrete tool names this toolset resolves to (sorted). */
  tools: string[];
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
}

/** Extended toolset payload returned by GET /hermes/tools/toolsets/{name}. */
export interface HermesToolsetDetail extends HermesToolset {
  /** Per-tool ``{name, description, emoji}`` (parallel to ``tools``). */
  items: HermesToolItem[];
  /** Provider/credential matrix — empty when the toolset has no category. */
  providers: HermesToolProvider[];
  /** True iff the toolset has a ``TOOL_CATEGORIES`` entry. */
  has_category: boolean;
}

export interface HermesToolsetDetailResponse {
  ok: boolean;
  toolset?: HermesToolsetDetail;
  error?: string;
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

/** GET /hermes/tools/toolsets — full list with state per item. */
export async function getHermesToolsets(): Promise<{
  ok: boolean;
  toolsets: HermesToolset[];
  error?: string;
}> {
  try {
    const res = await backplaneFetch("/hermes/tools/toolsets", {
      method: "GET",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
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
): Promise<HermesToolsetDetailResponse> {
  try {
    const url = `/hermes/tools/toolsets/${encodeURIComponent(name)}`;
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
}

export interface HermesInstalledMcpsResponse {
  ok: boolean;
  items: HermesInstalledMcp[];
  error?: string;
}

/** GET /hermes/tools/installed-mcps — user-installed MCP servers. */
export async function getHermesInstalledMcps(): Promise<HermesInstalledMcpsResponse> {
  try {
    const res = await backplaneFetch("/hermes/tools/installed-mcps", {
      method: "GET",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
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
 * Mirrors upstream PUT /api/tools/toolsets/{name}. Persists to
 * ``platform_toolsets.cli`` via the canonical helper, so the change
 * takes effect on the next agent session.
 */
export async function putHermesToolsetToggle(
  name: string,
  enabled: boolean,
): Promise<HermesToolToggleResponse> {
  try {
    const url = `/hermes/tools/toolsets/${encodeURIComponent(name)}`;
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
