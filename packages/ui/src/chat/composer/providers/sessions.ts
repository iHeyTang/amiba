import { getPlatform } from "@amiba/app-runtime/platform"
import type { LexicalEditor } from "lexical"
import { insertMentionAtTrigger } from "./skills"
import type { MenuItem, MentionData, TriggerProvider } from "./types"

export function makeSessionsProvider(): TriggerProvider {
  const dshSessions = getPlatform().agentSessions
  return {
    trigger: "@",
    id: "sessions",
    group: "Sessions",
    ownsType: "session",
    match: () => true,
    async search(query: string): Promise<MenuItem[]> {
      if (!dshSessions) return []
      const sessions = (await dshSessions.list()).map((session) => ({
        id: session.sessionId,
        title: session.title ?? session.sessionId,
      }))
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
      const label = (m.payload.title || m.payload.id).replace(/([\\\]])/gu, "\\$1")
      return `@[${label}](dsh-session:${base64UrlJson(m.payload.id)})`
    },
  }
}

function base64UrlJson(value: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "")
}
