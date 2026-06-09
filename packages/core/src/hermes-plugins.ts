/**
 * Read-only client for the backplane `/hermes/plugins` routes + the
 * enable/disable toggle. The backplane passes through hermes-agent's own
 * `get_plugin_manager().list_plugins()` (the exact source `hermes plugins
 * list` uses), so the UI and CLI never drift.
 */

import { backplaneFetch } from "./backplane-client";

/** One row from `get_plugin_manager().list_plugins()`. */
export interface HermesPlugin {
  name: string;
  /** Path-derived registry key; equals `name` for flat plugins. */
  key: string;
  /** standalone | backend | exclusive | platform | model-provider */
  kind: string;
  version: string;
  description: string;
  /** bundled | user | project | entrypoint */
  source: string;
  /** Effective state — whether the loader would load it. */
  enabled: boolean;
  tools: number;
  hooks: number;
  commands: number;
  error?: string | null;
}

export interface HermesPluginsResponse {
  ok: boolean;
  plugins: HermesPlugin[];
}

export async function getHermesPlugins(): Promise<HermesPluginsResponse> {
  try {
    const res = await backplaneFetch("/hermes/plugins", { method: "GET" });
    if (!res.ok) return { ok: false, plugins: [] };
    const data = (await res.json().catch(() => null)) as
      | { plugins?: HermesPlugin[] }
      | null;
    return {
      ok: true,
      plugins: Array.isArray(data?.plugins) ? (data!.plugins as HermesPlugin[]) : [],
    };
  } catch {
    return { ok: false, plugins: [] };
  }
}

export interface PluginToggleResult {
  ok: boolean;
  /** Backplane could not write (e.g. managed config) — surface to the user. */
  error?: string;
  /** Config edited; most plugins (un)load on the next agent start. */
  appliesOnRestart?: boolean;
}

/**
 * Enable or disable a plugin by name. Edits `config.yaml`'s
 * `plugins.enabled` / `plugins.disabled`; does NOT hot-reload — the change
 * applies on the next Hermes start (see `appliesOnRestart`).
 */
export async function setPluginEnabled(
  name: string,
  enabled: boolean,
): Promise<PluginToggleResult> {
  const path = `/hermes/plugins/${enabled ? "enable" : "disable"}?name=${encodeURIComponent(name)}`;
  try {
    const res = await backplaneFetch(path, { method: "POST" });
    const data = (await res.json().catch(() => null)) as
      | { error?: string; applies_on_restart?: boolean }
      | null;
    if (!res.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { ok: true, appliesOnRestart: data?.applies_on_restart ?? true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}
