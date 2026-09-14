import { referenceAppearance } from "../../reference-appearance"
import type { BuiltinMentionType, MentionData } from "./providers/types"

// Built-in mention types: payload field order for the colon/pipe body.
//
// `skill` and `session` are LEGACY: chips minted before the official
// input-trigger adoption carry them, and a draft persisted then must still
// rehydrate and still serialize to the same model form. New chips from a
// `/` or `@` pick are `dsh.reference` (below) — one shape for every source,
// Amiba's own and any plugin's.
const BUILTIN_FIELDS: Record<BuiltinMentionType, string[]> = {
  skill: ["name"],
  session: ["id", "title"],
  file: ["path"],
  page: ["tabId", "title"], // page may have no fields -> "@[page:]"
  // The official reference occurrence: which source owns it, the
  // source-scoped id its `codec.serialize` resolves, and the two user-facing
  // projections the owner supplied at insert time.
  "dsh.reference": ["source", "ref", "label", "clipboardText"],
}

// Dynamic mention types contributed by managed extension providers, keyed by
// registry key, e.g. "amiba.extension".
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
  // Escape backslashes too: the token scanner treats a raw backslash as
  // quoting its next character, including the closing token delimiter.
  return v.replace(/%/g, "%25").replace(/\\/g, "%5C").replace(/\|/g, "%7C").replace(/\]/g, "%5D")
}
function unesc(v: string): string {
  return v.replace(/%5C/g, "\\").replace(/%5D/g, "]").replace(/%7C/g, "|").replace(/%25/g, "%")
}

export function encodeMention(m: MentionData): string {
  const fields = fieldsFor(m.type) ?? []
  const values = fields.map((f) => esc(m.payload[f] ?? ""))
  const appearance = m.type === "dsh.reference" ? referenceAppearance(m.payload.appearance) : undefined
  if (appearance) values.push(appearance) // Optional tail; old tokens keep their exact encoding.
  const body = values.join("|")
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
  if (type === "dsh.reference") {
    const appearance = referenceAppearance(parts[4] === undefined ? undefined : unesc(parts[4]))
    if (appearance) payload.appearance = appearance
  }
  const display =
    payload.label || payload.title || payload.name || payload.key || payload.path || payload.id || type
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
