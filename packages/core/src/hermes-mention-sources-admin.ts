/**
 * Admin client for the backplane's mention-source lifecycle routes
 * (`/hermes/mention-sources*`). Lifecycle is plain git under the hood —
 * install = clone, update = pull, remove = rm. The desktop "Mention sources"
 * settings panel drives these.
 *
 * This is distinct from `hermes-mention-resources.ts`, which is the read-only
 * composer client (`/hermes/mention-resources` + per-source `search`).
 */

import { backplaneFetch } from "./backplane-client";

/** One row from `GET /hermes/mention-sources`. */
export interface MentionSourceInfo {
  name: string;
  path: string;
  search_mount: string;
  version?: string | null;
  description?: string | null;
  /** Whether the source exposes a `search` capability (false ⇒ misconfigured). */
  has_search: boolean;
  /** Whether the install is a git checkout (⇒ updatable via `git pull`). */
  is_git: boolean;
}

export interface MentionSourcesResponse {
  ok: boolean;
  sources: MentionSourceInfo[];
}

export async function getMentionSources(): Promise<MentionSourcesResponse> {
  try {
    const res = await backplaneFetch("/hermes/mention-sources", { method: "GET" });
    if (!res.ok) return { ok: false, sources: [] };
    const data = (await res.json().catch(() => null)) as
      | { sources?: MentionSourceInfo[] }
      | null;
    return {
      ok: true,
      sources: Array.isArray(data?.sources) ? (data!.sources as MentionSourceInfo[]) : [],
    };
  } catch {
    return { ok: false, sources: [] };
  }
}

export interface MentionSourceMutationResult {
  ok: boolean;
  name?: string;
  error?: string;
  /** Present on install if the source imported but exposed no `search`. */
  loadWarning?: string;
}

async function mutate(
  path: string,
  init: RequestInit,
): Promise<MentionSourceMutationResult> {
  try {
    const res = await backplaneFetch(path, init);
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; name?: string; error?: string; detail?: string; load_warning?: string }
      | null;
    if (!res.ok) {
      return { ok: false, error: data?.error || data?.detail || `HTTP ${res.status}` };
    }
    return { ok: true, name: data?.name, loadWarning: data?.load_warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

/** Install a source by git URL (or a local path, for dev). */
export function installMentionSource(args: {
  from_git?: string;
  from_path?: string;
  name?: string;
  ref?: string;
  overwrite?: boolean;
}): Promise<MentionSourceMutationResult> {
  return mutate("/hermes/mention-sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
}

/** `git pull` + re-import a source. */
export function updateMentionSource(name: string): Promise<MentionSourceMutationResult> {
  return mutate(
    `/hermes/mention-sources/update?name=${encodeURIComponent(name)}`,
    { method: "POST" },
  );
}

/** Remove a source (delete its dir + drop from the registry). */
export function removeMentionSource(name: string): Promise<MentionSourceMutationResult> {
  return mutate(`/hermes/mention-sources/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
