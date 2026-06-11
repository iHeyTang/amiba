/**
 * Read-only client for the backplane `GET /hermes/mention-resources` route
 * and the per-integration search endpoints it points at.
 *
 * The backplane aggregates every installed integration's `mention_resources`
 * declaration into one registry; the composer turns each entry into a generic
 * `@`-mention provider. The backend never parses `@[...]` tokens — it only
 * describes which resource types exist and how to search / serialize them.
 */

import { backplaneFetch } from "./backplane-client";

/** One mentionable resource type contributed by an integration. */
export interface MentionResource {
  /** Registry key, `<integration>.<type>` — e.g. `lark.doc`. */
  key: string;
  integration: string;
  type: string;
  label: string;
  icon?: string | null;
  trigger: "@" | "/";
  /**
   * Payload field order for the `@[key:a|b]` token body. Also the source of the
   * "handles" in the agent-visible reference line — the composer owns that
   * format (`(label: name · handle…)`), the source just declares the fields.
   */
  fields: string[];
  /** Path to the integration's search endpoint, with `?type=` pre-filled. */
  search: string;
  group: string;
  /**
   * This type's search needs a non-empty query — it can't list a default set
   * (e.g. Feishu doc/contact search). The composer shows `empty_hint` as the
   * category's empty state instead of an empty/absent group.
   */
  requires_query?: boolean;
  /** Empty-state prompt for a `requires_query` type (source-authored). */
  empty_hint?: string | null;
}

export interface MentionResourcesResponse {
  ok: boolean;
  resources: MentionResource[];
}

/** One search hit for a mentionable resource. */
export interface MentionSearchItem {
  id: string;
  title: string;
  detail?: string;
  /** Carries exactly the `fields` the resource declared, for the chip. */
  payload: Record<string, string>;
}

export async function getMentionResources(): Promise<MentionResourcesResponse> {
  try {
    const res = await backplaneFetch("/hermes/mention-resources", { method: "GET" });
    if (!res.ok) return { ok: false, resources: [] };
    const data = (await res.json().catch(() => null)) as
      | { resources?: MentionResource[] }
      | null;
    return {
      ok: true,
      resources: Array.isArray(data?.resources) ? (data!.resources as MentionResource[]) : [],
    };
  } catch {
    return { ok: false, resources: [] };
  }
}

/**
 * Query one resource type's search endpoint. `searchPath` is the registry
 * entry's `search` field (already carries `?type=`); we append `q`/`limit`.
 * Always resolves to a list — transport/empty failures degrade to `[]` so the
 * composer just shows no candidates.
 */
export async function searchMentionResource(
  searchPath: string,
  query: string,
  limit = 8,
): Promise<MentionSearchItem[]> {
  try {
    const sep = searchPath.includes("?") ? "&" : "?";
    const url = `${searchPath}${sep}q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await backplaneFetch(url, { method: "GET" });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as
      | { items?: MentionSearchItem[] }
      | null;
    return Array.isArray(data?.items) ? (data!.items as MentionSearchItem[]) : [];
  } catch {
    return [];
  }
}
