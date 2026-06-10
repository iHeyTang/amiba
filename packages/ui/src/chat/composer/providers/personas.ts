import { getHermesPersonalities } from "@amiba/core"
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

let cache: { key: string; preview: string }[] | null = null
async function load() {
  if (cache) return cache
  const res = await getHermesPersonalities()
  cache = res.ok ? res.personalities.map((p) => ({ key: p.key, preview: p.preview })) : []
  return cache
}

export function makePersonasProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "personas",
    group: "Personas",
    ownsType: "persona",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const q = query.toLowerCase()
      const list = await load()
      return list
        .filter((p) => p.key.toLowerCase().includes(q))
        .slice(0, 15)
        .map((p) => ({
          id: `personas:${p.key}`,
          label: p.key,
          description: p.preview,
          insert: { type: "persona", payload: { key: p.key }, display: p.key } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(persona: ${m.payload.key})`
    },
  }
}
