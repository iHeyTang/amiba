import type { PluginMessageOrigin } from "@amiba/app-runtime/protocol"

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
 * The ONE `ContextForm` value (`@deepseek-ai/dsh-llm`) whose plugin-produced
 * user-role message is CONVERSATION material — something addressed to this
 * session that a person should see in the transcript as a user turn:
 *
 *   - `relay` — "a message another agent addressed to this one". The
 *               steward's task brief and an IM connector's inbound message
 *               are both this, and both stamp it explicitly.
 *
 * Every other shape a plugin injects is MODEL CONTEXT, not conversation, and
 * the bar is deliberately this strict: a kept message renders as the USER
 * speaking (with an attribution chip), so anything less than an explicit
 * "this was addressed to the session" puts a plugin's words in the person's
 * mouth. `instructions` (workspace files the model must follow), `catalog`
 * (an inventory republished as it changes), `snapshot` (current state
 * superseded by the next one) and `recall` (material lifted out of another
 * session's log) are machinery. `notice` — "a one-off account of something
 * that just happened" — is machinery too: a guard's reminder to the MODEL
 * (repeat-tool-reminder's "you are repeating the same call") is the
 * canonical notice, and DSH's own transcript shows it as a collapsed
 * context row keyed by its `summary`, never as a user bubble. An ABSENT
 * `form` is what DSH documents as "presented as opaque content": undeclared
 * context, dropped for the same reason.
 */
const CONVERSATIONAL_FORMS: ReadonlySet<string> = new Set(["relay"])

/** What a `user/message`'s `source` says about showing that message. */
export interface VisibleUserMessage {
  /**
   * Attribution to render beside the bubble; absent for a message the person
   * typed themselves (the ordinary case, which needs no attribution).
   */
  origin?: PluginMessageOrigin
}

/**
 * Whether a `user/message` with this `source` belongs in the conversation,
 * and what it is attributed to. `null` means drop it.
 *
 * - `kind: "user"` (or no source at all) — the person typed it. Kept, no
 *   attribution.
 * - `kind: "plugin"` with `form: "relay"` and a `plugin` name — kept and
 *   attributed to that plugin (see {@link CONVERSATIONAL_FORMS}). Any other
 *   form, or no form, is injected context and dropped.
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
  const form = source?.form
  if (typeof form !== "string" || !CONVERSATIONAL_FORMS.has(form)) return null
  const plugin = typeof source?.plugin === "string" ? source.plugin : ""
  return plugin ? { origin: { kind: "plugin", plugin } } : null
}

/** A message's words, with its `<file-attachment>` envelopes lifted out. */
export interface UserMessageText {
  /** The text a person reads: every envelope removed, parts joined by `\n`. */
  text: string
  /** One badge per attachment the envelopes described, in wire order. */
  badges: AttachmentBadge[]
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
 * Both consumers call this, so a relayed message carrying an envelope reads
 * the same live as it does after a reload — the bridge simply has nowhere to
 * put `badges` yet (`StreamEvent.userMessage` carries text only, and
 * attachments are a composer feature no plugin relay uses today), while the
 * durable projection renders them as chips.
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
  return { text: texts.join("\n"), badges }
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
