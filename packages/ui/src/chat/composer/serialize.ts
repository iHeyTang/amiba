import type { MentionData, MentionType } from "./providers/types"

const KNOWN: MentionType[] = ["skill", "session", "persona", "channel", "file", "page"]
const TOKEN_RE = /@\[([a-z]+):((?:[^\]\\]|\\.)*)\]/g

// payload field order per type for the colon/pipe body
const FIELDS: Record<MentionType, string[]> = {
  skill: ["name"],
  session: ["id", "title"],
  persona: ["key"],
  channel: ["id"],
  file: ["path"],
  page: ["tabId", "title"], // page may have no fields -> "@[page:]"
}

function esc(v: string): string {
  // escape pipe + closing bracket so the body parses unambiguously
  return v.replace(/%/g, "%25").replace(/\|/g, "%7C").replace(/\]/g, "%5D")
}
function unesc(v: string): string {
  return v.replace(/%5D/g, "]").replace(/%7C/g, "|").replace(/%25/g, "%")
}

export function encodeMention(m: MentionData): string {
  const fields = FIELDS[m.type] ?? []
  const body = fields.map((f) => esc(m.payload[f] ?? "")).join("|")
  return `@[${m.type}:${body}]`
}

export type ParsedPart =
  | { kind: "text"; text: string }
  | { kind: "mention"; mention: MentionData; raw: string }

function decode(type: string, body: string): MentionData | null {
  if (!KNOWN.includes(type as MentionType)) return null
  const t = type as MentionType
  const fields = FIELDS[t]
  const parts = body.length ? body.split("|") : []
  const payload: Record<string, string> = {}
  fields.forEach((f, i) => { payload[f] = unesc(parts[i] ?? "") })
  const display =
    payload.title || payload.name || payload.key || payload.path || payload.id || t
  return { type: t, payload, display }
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
