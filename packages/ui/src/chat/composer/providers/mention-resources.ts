import {
  getMentionResources,
  searchMentionResource,
  type MentionResource,
} from "@amiba/core"
import type { LexicalEditor } from "lexical"
import { registerMentionType } from "../serialize"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

/**
 * Build one generic `@`-provider from a backplane mention-resource entry.
 *
 * The provider is fully data-driven: it searches the integration's endpoint,
 * inserts a chip whose `type` is the registry key, and on send expands into a
 * self-describing reference line the agent resolves with the integration's
 * resolver skill. The reference-line FORMAT is owned here (host), not by the
 * source — the source only declares `label` + `fields`, so every external
 * mention serializes identically and can't drift. No per-integration UI code.
 */
export function makeMentionResourceProvider(entry: MentionResource): TriggerProvider {
  // Keep the token <-> payload field mapping in lockstep with the backend.
  registerMentionType(entry.key, entry.fields)
  return {
    trigger: entry.trigger === "/" ? "/" : "@",
    id: `mention-resource:${entry.key}`,
    group: entry.group || entry.integration,
    ownsType: entry.key,
    requiresQuery: entry.requires_query === true,
    emptyHint: entry.empty_hint ?? undefined,
    persistent: true, // a stable category: stay visible even with no results
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      // Up to 50: types that can list a default set (e.g. lark chats) return
      // a useful batch on an empty query; searches return the top matches.
      const items = await searchMentionResource(entry.search, query, 50)
      return items.map((it) => ({
        id: `${entry.key}:${it.id}`,
        label: it.title || it.id,
        description: it.detail,
        insert: {
          type: entry.key,
          payload: it.payload || {},
          display: it.title || it.id,
        } as MentionData,
      }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (!item.insert) return
      insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      // Host-owned uniform format: "(<label>: <name> · <handle…>)". The name is
      // the chip's display; the handles are the remaining declared field values
      // (e.g. url / chat_id). The source fills the blanks; it never sets format.
      const handles = entry.fields
        .map((f) => m.payload[f])
        .filter((v): v is string => !!v && v !== m.display)
      return `(${entry.label}: ${[m.display, ...handles].filter(Boolean).join(" · ")})`
    },
  }
}

/**
 * Fetch the backplane registry and build one provider per resource type.
 * Resolves to `[]` when the backplane is down or has no integrations, so the
 * composer degrades to its built-in providers only.
 */
export async function loadMentionResourceProviders(): Promise<TriggerProvider[]> {
  const res = await getMentionResources()
  if (!res.ok) return []
  return res.resources.map(makeMentionResourceProvider)
}
