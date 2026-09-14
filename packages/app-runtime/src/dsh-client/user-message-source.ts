import type {
  MessageImage,
  MessageNotice,
  PluginMessageOrigin,
} from "@amiba/app-runtime/protocol"

import { durableContentImages } from "./content-images"

import { splitFileAttachmentsFromPrompt } from "../core/attachments/format"
import type { AttachmentBadge } from "../core/attachments/types"

/**
 * The ONE projection of a DSH `user/message` frame's `source` and `content`.
 *
 * Two consumers read it and must agree, or a message changes shape the moment
 * the conversation is reloaded: the durable-log projection
 * (`core/runtime-session-history.ts`, what `loadMessages` renders) and the
 * live mux bridge (`amiba-event-bridge.ts`, what an open conversation
 * streams). Both derive the same `uiId`, the same text and the same
 * attribution from the same wire shape, so a plugin-dispatched message that
 * arrived live and the same message re-read from history are one bubble, not
 * two.
 *
 * It lives beside `tool-wire.ts` for the same reason that module does: it is
 * wire-shape knowledge shared across the core/dsh-client boundary, and core
 * already depends on `dsh-client` for exactly this class of helper.
 */

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

/**
 * The TWO `ContextForm` values (`@deepseek-ai/dsh-llm`) whose plugin-produced
 * user-role message reaches the transcript, and the two different things the
 * transcript makes of them:
 *
 *   - `relay`  — "a message another agent addressed to this one". The
 *                steward's task brief and an IM connector's inbound message
 *                are both this, and both stamp it explicitly. Someone said
 *                this TO the session, so it renders as a user turn with an
 *                attribution chip.
 *   - `notice` — "a one-off account of something that just happened; it
 *                supersedes nothing". A steward task report and a guard's
 *                reminder to the model (repeat-tool-reminder's "you are
 *                repeating the same call") are both this. Nobody addressed
 *                it to anyone, so it is CONVERSATION-ADJACENT, not a turn:
 *                it renders as a collapsed context row keyed by the
 *                producer's own `summary` — exactly what DSH's own
 *                transcript does with one — and NEVER as a user bubble.
 *                A `notice` whose `summary` is missing or not a string is
 *                malformed (the DSH source type requires it) and dropped:
 *                the row has nothing to show collapsed.
 *
 * Every other shape a plugin injects is MODEL CONTEXT with no place in the
 * transcript at all: `instructions` (workspace files the model must follow),
 * `catalog` (an inventory republished as it changes), `snapshot` (current
 * state superseded by the next one) and `recall` (material lifted out of
 * another session's log) are machinery. An ABSENT `form` is what DSH
 * documents as "presented as opaque content": undeclared context, dropped
 * for the same reason.
 */
const RELAY_FORM = "relay"
const NOTICE_FORM = "notice"

/** What a `user/message`'s `source` says about showing that message. */
export interface VisibleUserMessage {
  /**
   * Attribution to render beside the bubble; absent for a message the person
   * typed themselves (the ordinary case, which needs no attribution).
   */
  origin?: PluginMessageOrigin
  /**
   * Present iff this is an ACCOUNT rather than a turn — the producer's
   * one-line summary, which the surface shows on a collapsed row instead of
   * a user bubble. Never set without an `origin`.
   */
  notice?: MessageNotice
}

/**
 * Whether a `user/message` with this `source` belongs in the conversation,
 * and what it is attributed to. `null` means drop it.
 *
 * - `kind: "user"` (or no source at all) — the person typed it. Kept, no
 *   attribution.
 * - `kind: "plugin"` with `form: "relay"` and a `plugin` name — kept as a
 *   user turn, attributed to that plugin.
 * - `kind: "plugin"` with `form: "notice"`, a string `summary` and a `plugin`
 *   name — kept as a collapsed context row carrying that summary, attributed
 *   to that plugin. Any other form, or no form, is injected context and
 *   dropped.
 * - `kind: "plugin"` with NO `plugin` name — dropped. `plugin` is required by
 *   the DSH source type, so this shape is malformed; there is nothing to
 *   attribute it to, and a plugin-produced message that cannot say who
 *   produced it is exactly the thing the transcript should not silently
 *   pass off as the user's own words. Dropping is also what keeps the two
 *   consumers symmetrical: the live bridge maps a `userMessage` event only
 *   when there IS an origin, so any other answer here would mean a message
 *   that appears on reload but never live.
 * - `kind: "tool"` / `kind: "model"` / any future kind — dropped. A tool
 *   result rides a user-role message on the wire and is rendered by the
 *   assistant turn's own tool chips, never as a user bubble.
 */
export function visibleUserMessage(value: unknown): VisibleUserMessage | null {
  const source = record(value)
  const kind = source?.kind
  if (kind === undefined || kind === "user") return {}
  if (kind !== "plugin") return null
  const plugin = typeof source?.plugin === "string" ? source.plugin : ""
  if (!plugin) return null
  const origin: PluginMessageOrigin = { kind: "plugin", plugin }
  const form = source?.form
  if (form === RELAY_FORM) {
    if (typeof source?.senderName === "string" && source.senderName.trim()) {
      origin.senderName = source.senderName.trim()
    }
    return { origin }
  }
  if (form !== NOTICE_FORM) return null
  const summary = source?.summary
  return typeof summary === "string" && summary
    ? { origin, notice: { summary } }
    : null
}

/** A message's words, with its `<file-attachment>` envelopes lifted out. */
export interface UserMessageText {
  /** The text a person reads: every envelope removed, parts joined by `\n`. */
  text: string
  /** Native envelope badges plus otherwise unrepresented durable files. */
  badges: AttachmentBadge[]
  /** Valid durable image blocks in their original content order. */
  images: MessageImage[]
}

/**
 * The readable text of a `user/message`'s `content`, and the attachments its
 * envelopes describe.
 *
 * Each `text` part is passed through the attachment splitter individually
 * rather than the joined string: since the two-part wire format the
 * attachment metadata is its own part (splitting it leaves empty text and
 * yields badges), while legacy sessions carry one merged part that the same
 * splitter divides in place. A plain-string `content` (older logs) counts as
 * a single part.
 *
 * Both consumers carry the same badges, so a relayed file message reads the
 * same live as after reload. Durable image references remain separate from
 * file badges, without turning staging IDs into durable references.
 */
export function userMessageText(content: unknown): UserMessageText {
  const parts =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.flatMap((part) => {
            const item = record(part)
            return item?.type === "text" && typeof item.text === "string"
              ? [item.text]
              : []
          })
        : []
  const badges: AttachmentBadge[] = []
  const texts: string[] = []
  for (const part of parts) {
    const split = splitFileAttachmentsFromPrompt(part)
    badges.push(...split.badges)
    if (split.text) texts.push(split.text)
  }
  // Native messages also carry legacy metadata for Amiba's ID-based tools.
  // Match occurrences one-to-one so a dual representation gets one badge,
  // while repeated standalone official file blocks remain distinct.
  const unmatched = badges.filter(badge => badge.kind !== "image").slice()
  if (Array.isArray(content)) content.forEach((part, index) => {
    const item = record(part)
    const file = record(item?.attachment)
    if (item?.type !== "file" || !file || typeof file.attachmentId !== "string" || !file.attachmentId
      || typeof file.name !== "string" || !file.name || typeof file.bytes !== "number"
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0) return
    const existing = unmatched.findIndex(badge => badge.name === file.name && badge.size === file.bytes)
    if (existing >= 0) { unmatched.splice(existing, 1); return }
    // A durable DSH hash is not an Amiba staging ID: display it without routing
    // clicks to the native attachment reader under a fabricated identity.
    badges.push({ uiId: `dsh-file:${file.attachmentId}:${index}`, name: file.name,
      size: file.bytes, mime: "application/octet-stream", kind: "binary" })
  })
  const images = durableContentImages(content)
  return { text: texts.join("\n"), badges, images }
}

/**
 * The stable presentation id for a `user/message`, derived from the message's
 * own DSH id when it has one and from its sequence number otherwise. Both the
 * live bridge and the durable projection call this, so the live bubble and
 * the reloaded one collide on the same id instead of appearing twice.
 */
export function userMessageUiId(id: unknown, seq: number): string {
  return typeof id === "string" && id ? `dsh:${id}` : `dsh:user:${seq}`
}

/** Shared projection for live and durable `amiba/notice` events. Unknown
 * versions/malformed references fail closed instead of navigating by text. */
export function presentationNotice(value: unknown) {
  const data = record(value)
  if (data?.version !== 1 || ![data.id, data.source, data.summary].every(v => typeof v === "string" && v.trim()) || typeof data.body !== "string") return null
  const ref = record(data.reference)
  if (data.reference !== undefined && (!ref || ![ref.kind, ref.sessionId, ref.id].every(v => typeof v === "string" && v.trim()))) return null
  if (ref?.instance !== undefined && (typeof ref.instance !== "string" || !ref.instance)) return null
  const placement = record(data.placement)
  if (data.placement !== undefined && (!placement ||
    (placement.kind !== "standalone" && placement.kind !== "execution") ||
    (placement.kind === "execution" && ![placement.sessionId, placement.callId].every(v => typeof v === "string" && v.trim())))) return null
  const display = placement?.kind === "execution"
    ? { kind: "execution" as const, sessionId: placement.sessionId as string, callId: placement.callId as string }
    : placement ? {kind: "standalone" as const} : undefined
  return {
    uiId: `dsh:notice:${data.id}`,
    content: data.body,
    origin: { kind: "plugin" as const, plugin: data.source as string },
    notice: { summary: data.summary as string, ...(display ? {placement: display} : {}), ...(ref ? { reference: { kind: ref.kind as string, sessionId: ref.sessionId as string, id: ref.id as string, ...(typeof ref.instance === "string" ? { instance: ref.instance } : {}) } } : {}) },
  }
}
