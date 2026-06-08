import { parseTokens } from "./serialize"
import type { MentionType, TriggerProvider } from "./providers/types"

export function expandMentions(value: string, providers: TriggerProvider[]): string {
  // Index serializing providers by the mention type they own.
  const byType = new Map<MentionType, TriggerProvider>()
  for (const p of providers) {
    if (p.serialize && p.ownsType && !byType.has(p.ownsType)) {
      byType.set(p.ownsType, p)
    }
  }
  return parseTokens(value)
    .map((part) => {
      if (part.kind === "text") return part.text
      const p = byType.get(part.mention.type)
      return p?.serialize ? p.serialize(part.mention) : part.raw
    })
    .join("")
}
