import {
  getMentionResources,
  searchMentionResource,
  type MentionResource,
} from "@amiba/core"
import type { LexicalEditor } from "lexical"
import { registerMentionType } from "../serialize"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

/** Expand a `{field}` template against a mention's payload. Missing -> "". */
function applyTemplate(template: string, payload: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => payload[key] ?? "")
}

/**
 * Build one generic `@`-provider from a backplane mention-resource entry.
 *
 * The provider is fully data-driven: it searches the integration's endpoint,
 * inserts a chip whose `type` is the registry key, and on send expands via the
 * declared `serialize` template into a self-describing reference line the agent
 * resolves with the integration's resolver skill. No per-integration UI code.
 */
export function makeMentionResourceProvider(entry: MentionResource): TriggerProvider {
  // Keep the token <-> payload field mapping in lockstep with the backend.
  registerMentionType(entry.key, entry.fields)
  return {
    trigger: entry.trigger === "/" ? "/" : "@",
    id: `mention-resource:${entry.key}`,
    group: entry.group || entry.integration,
    ownsType: entry.key,
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const items = await searchMentionResource(entry.search, query, 12)
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
      return entry.serialize ? applyTemplate(entry.serialize, m.payload) : m.display || ""
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
