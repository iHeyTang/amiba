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

export async function expandMentionsAsync(
  value: string,
  providers: TriggerProvider[],
): Promise<string> {
  const byType = new Map<MentionType, TriggerProvider>()
  for (const provider of providers) {
    if (provider.ownsType && !byType.has(provider.ownsType)) {
      byType.set(provider.ownsType, provider)
    }
  }
  const chunks = await Promise.all(parseTokens(value).map(async (part) => {
    if (part.kind === "text") return part.text
    const provider = byType.get(part.mention.type)
    if (provider?.resolveMention) {
      try {
        return await provider.resolveMention(part.mention)
      } catch (error) {
        return `[Resource unavailable: ${part.mention.display} — ${error instanceof Error ? error.message : String(error)}]`
      }
    }
    return provider?.serialize ? provider.serialize(part.mention) : part.raw
  }))
  return chunks.join("")
}
