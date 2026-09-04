import type { PluginMessageOrigin } from "@amiba/app-runtime/protocol"

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
 * `ContextForm` values (`@deepseek-ai/dsh-llm`) whose plugin-produced
 * user-role message is CONVERSATION material — something addressed to this
 * session that a person should see in the transcript:
 *
 *   - `relay`  — a message another agent (or a connector's remote human)
 *                addressed to this one. The steward's task brief and an IM
 *                connector's inbound message are both this.
 *   - `notice` — a one-off account of something that just happened.
 *
 * Everything else a plugin injects is MODEL CONTEXT, not conversation:
 * `instructions` (workspace files the model must follow), `catalog` (an
 * inventory republished as it changes), `snapshot` (current state superseded
 * by the next one) and `recall` (material lifted out of another session's
 * log) are all machinery the transcript would only be noisier for showing —
 * which is why the projection dropped every non-user source before this
 * module existed. An ABSENT `form` is treated as conversation too: it is the
 * shape a producer sends when it is simply speaking to the session.
 */
const CONVERSATIONAL_FORMS: ReadonlySet<string> = new Set(["relay", "notice"])

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
 * - `kind: "plugin"` with a conversational `form` — kept and attributed to
 *   the plugin (see {@link CONVERSATIONAL_FORMS}). A malformed registration
 *   with no `plugin` name is still kept, just unattributed: the message is
 *   real conversation either way and hiding it is the bug this replaced.
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
  if (typeof form === "string" && !CONVERSATIONAL_FORMS.has(form)) return null
  if (form !== undefined && typeof form !== "string") return null
  const plugin = typeof source?.plugin === "string" ? source.plugin : ""
  return plugin ? { origin: { kind: "plugin", plugin } } : {}
}

/**
 * The `text` parts of a message's `content`, in order. A plain-string content
 * (older logs) counts as a single part.
 *
 * Parts stay SPLIT rather than pre-joined because the durable projection
 * still has to run each one through the attachment-envelope splitter: since
 * the two-part wire format the attachment metadata is its own part, while
 * legacy sessions carry one merged part that the same splitter divides in
 * place. Callers with no attachment concern (the live bridge) join with
 * `"\n"`, exactly as the projection does after splitting.
 */
export function userMessageTextParts(content: unknown): string[] {
  if (typeof content === "string") return [content]
  if (!Array.isArray(content)) return []
  const texts: string[] = []
  for (const part of content) {
    const item = record(part)
    if (item?.type === "text" && typeof item.text === "string") {
      texts.push(item.text)
    }
  }
  return texts
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
