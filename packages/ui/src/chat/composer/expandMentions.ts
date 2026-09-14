import { parseTokens, type ParsedPart } from "./serialize"
import { REFERENCE_MENTION_TYPE } from "./triggers/editor-ops"
import type { MentionData, MentionType, TriggerProvider } from "./providers/types"

/**
 * Resolves one reference occurrence to its model form. In-session this IS the
 * official `InputTriggerController.serializeReference`; on surfaces with no
 * plugin runtime it is `localReferenceResolver` over the same sources. Both
 * REJECT for an unknown source or a codec-less one — a failed serialization
 * must block the send, never silently downgrade to the clipboard text.
 */
export interface ReferenceResolver {
  serializeReference(
    source: string,
    ref: string,
    signal: AbortSignal,
  ): Promise<string>
}

/**
 * Legacy chips, minted before the official input-trigger adoption, expressed
 * as reference occurrences so they resolve through the very same codecs
 * rather than through a second serializer kept alive beside them.
 */
export function legacyReferenceOf(
  mention: MentionData,
): { source: string; ref: string } | null {
  if (mention.type === "skill" && mention.payload.name) {
    return { source: "skill", ref: mention.payload.name }
  }
  if (mention.type === "session" && mention.payload.id) {
    return { source: "session", ref: mention.payload.id }
  }
  return null
}

/** The occurrence a mention names, or null when it is not a reference. */
function referenceOf(
  mention: MentionData,
): { source: string; ref: string } | null {
  if (mention.type === REFERENCE_MENTION_TYPE) {
    const { source, ref } = mention.payload
    return source && ref ? { source, ref } : null
  }
  return legacyReferenceOf(mention)
}

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
  resolver?: ReferenceResolver,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  return expandMentionPartsAsync(parseTokens(value), providers, resolver, signal)
}

/** A live editor already knows which text is literal; do not parse it again. */
export async function expandMentionPartsAsync(
  parts: readonly ParsedPart[],
  providers: TriggerProvider[],
  resolver?: ReferenceResolver,
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  signal.throwIfAborted()
  const byType = new Map<MentionType, TriggerProvider>()
  for (const provider of providers) {
    if (provider.ownsType && !byType.has(provider.ownsType)) {
      byType.set(provider.ownsType, provider)
    }
  }
  const chunks = await Promise.all(parts.map(async (part) => {
    if (part.kind === "text") return part.text
    const reference = referenceOf(part.mention)
    if (reference !== null && resolver !== undefined) {
      // The official rule: a serialization failure BLOCKS the send. The
      // caller (Composer.handleSend) surfaces it and keeps the draft.
      return resolver.serializeReference(
        reference.source,
        reference.ref,
        signal,
      )
    }
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
  signal.throwIfAborted()
  return chunks.join("")
}
