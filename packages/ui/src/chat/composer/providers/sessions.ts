import { listHermesSessions } from "@amiba/core"
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

export function makeSessionsProvider(): TriggerProvider {
  return {
    trigger: "@",
    id: "sessions",
    group: "Sessions",
    ownsType: "session",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      const res = await listHermesSessions({})
      const sessions = "sessions" in res ? res.sessions : []
      const q = query.toLowerCase()
      return sessions
        .filter((s) => (s.title ?? "").toLowerCase().includes(q))
        .slice(0, 15)
        .map((s) => ({
          id: `sessions:${s.id}`,
          label: s.title || s.id,
          insert: { type: "session", payload: { id: s.id, title: s.title ?? "" }, display: s.title || s.id } as MentionData,
        }))
    },
    onSelect(item: MenuItem, editor: LexicalEditor) {
      if (item.insert) insertMentionAtTrigger(editor, item.insert)
    },
    serialize(m: MentionData): string {
      return `(session: ${m.payload.title || m.payload.id})`
    },
  }
}
