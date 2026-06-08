import type { BuiltinMentionType, MentionData } from "./providers/types"

// Built-in mention types: payload field order for the colon/pipe body.
const BUILTIN_FIELDS: Record<BuiltinMentionType, string[]> = {
  skill: ["name"],
  session: ["id", "title"],
  persona: ["key"],
  channel: ["id"],
  file: ["path"],
  page: ["tabId", "title"], // page may have no fields -> "@[page:]"
}

// Dynamic mention types contributed by backplane integrations
// (GET /hermes/mention-resources), keyed by registry key, e.g. "lark.doc".
// Registered at runtime when the mention-resource providers are built, so the
// token <-> payload mapping stays in lockstep with what the backend declares.
const dynamicFields: Record<string, string[]> = {}

/** Teach the serializer a dynamic resource type's payload field order. */
export function registerMentionType(key: string, fields: string[]): void {
  dynamicFields[key] = [...fields]
}

function fieldsFor(type: string): string[] | null {
  if (type in BUILTIN_FIELDS) return BUILTIN_FIELDS[type as BuiltinMentionType]
  if (type in dynamicFields) return dynamicFields[type]
  return null
}

// Registry keys may contain dots (e.g. "lark.doc"); built-ins are bare words.
const TOKEN_RE = /@\[([a-z][a-z0-9.]*):((?:[^\]\\]|\\.)*)\]/g

function esc(v: string): string {
  // escape pipe + closing bracket so the body parses unambiguously
  return v.replace(/%/g, "%25").replace(/\|/g, "%7C").replace(/\]/g, "%5D")
}
function unesc(v: string): string {
  return v.replace(/%5D/g, "]").replace(/%7C/g, "|").replace(/%25/g, "%")
}

export function encodeMention(m: MentionData): string {
  const fields = fieldsFor(m.type) ?? []
  const body = fields.map((f) => esc(m.payload[f] ?? "")).join("|")
  return `@[${m.type}:${body}]`
}

export type ParsedPart =
  | { kind: "text"; text: string }
  | { kind: "mention"; mention: MentionData; raw: string }

function decode(type: string, body: string): MentionData | null {
  const fields = fieldsFor(type)
  if (fields === null) return null // unknown/unregistered -> leave as plain text
  const parts = body.length ? body.split("|") : []
  const payload: Record<string, string> = {}
  fields.forEach((f, i) => { payload[f] = unesc(parts[i] ?? "") })
  const display =
    payload.title || payload.name || payload.key || payload.path || payload.id || type
  return { type, payload, display }
}

export function parseTokens(value: string): ParsedPart[] {
  const out: ParsedPart[] = []
  let last = 0
  for (const match of value.matchAll(TOKEN_RE)) {
    const [raw, type, body] = match
    const start = match.index ?? 0
    const mention = decode(type, body)
    if (!mention) continue // unknown -> leave inside following text slice
    if (start > last) out.push({ kind: "text", text: value.slice(last, start) })
    out.push({ kind: "mention", mention, raw })
    last = start + raw.length
  }
  if (last < value.length) out.push({ kind: "text", text: value.slice(last) })
  return out.length ? out : [{ kind: "text", text: value }]
}
