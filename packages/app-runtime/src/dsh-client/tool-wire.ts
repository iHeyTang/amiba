/**
 * Verbatim tool-event extraction shared by Amiba's TWO DSH tool producers:
 * the durable-log projection (`core/runtime-session-history.ts`) and the live
 * mux bridge (`dsh-client/amiba-event-bridge.ts`). Both fold the same
 * `tool/call` / `tool/result` events into `ToolProgress`, keeping their parsed
 * and flattened conveniences; these readers retain the RAW forms beside them
 * so a presentation layer can rebuild the DSH runtime's own frozen call /
 * result node without re-reading the event log.
 *
 * Field selection mirrors the DSH client runtime's own root-node builders
 * one-for-one (`rootCall` / `rootResult` in
 * `@deepseek-ai/dsh-client-ui-conversation`): same wire members, same
 * absent-frame behaviour, no validation upstream does not do. It lives beside
 * the mux bridge because it encodes DSH wire semantics, not a runtime-neutral
 * product concept; the history projection is itself a DSH-log fold and
 * imports it directly.
 */

import type {
  ToolCallWireRecord,
  ToolResultWireRecord,
} from "@amiba/app-runtime/protocol"

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * The `view` member of a tool event view whose `for` discriminant matches, or
 * `null` — the documented default meaning "no host render intent, use the
 * generic card". Exactly the upstream expression
 * `match.view?.for === "call" ? match.view.view : null`.
 */
function viewFor(value: unknown, expected: "call" | "result"): unknown {
  const wrapper = record(value)
  if (!wrapper || wrapper.for !== expected) return null
  return wrapper.view ?? null
}

/**
 * The tool-result block carrying the result payload. On the real DSH wire a
 * tool-result message's content is exactly one `tool-result` block, which is
 * what upstream reads (`message.content[0]`); older flat logs put the blocks
 * directly on the message, and that shape is tolerated by the callers below.
 */
function toolResultBlock(
  message: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!Array.isArray(message?.content)) return null
  const first = record(message.content[0])
  return first?.type === "tool-result" ? first : null
}

/** `{ name, code }` when the event reported a tool-internal failure identity. */
function failureIdentity(
  value: unknown,
): { name: string; code: string } | undefined {
  const error = record(value)
  if (!error) return undefined
  return typeof error.name === "string" && typeof error.code === "string"
    ? { name: error.name, code: error.code }
    : undefined
}

/**
 * Retain one `tool/call` frame.
 *
 * @param data - the event's `data` payload.
 * @param time - the event's `time` (unix epoch ms).
 * @param view - the frame's tool event view, when the host computed one.
 * @returns the verbatim call-side record.
 */
export function toolCallWireRecord(
  data: Record<string, unknown>,
  time: number,
  view: unknown,
): ToolCallWireRecord {
  return {
    argsRaw: typeof data.arguments === "string" ? data.arguments : "",
    turn: typeof data.turn === "number" ? data.turn : 0,
    step: typeof data.step === "number" ? data.step : 0,
    time,
    callView: viewFor(view, "call"),
  }
}

/**
 * Retain one `tool/result` frame.
 *
 * @param data - the event's `data` payload.
 * @param seq - the event's `seq`.
 * @param time - the event's `time` (unix epoch ms).
 * @param view - the frame's tool event view, when the host computed one.
 * @returns the verbatim result-side record.
 */
export function toolResultWireRecord(
  data: Record<string, unknown>,
  seq: number,
  time: number,
  view: unknown,
): ToolResultWireRecord {
  const message = record(data.message)
  const block = toolResultBlock(message)
  // Real wire: the nested tool-result block owns both members. Flat legacy
  // logs keep the blocks (and any isError) on the message itself.
  const content = block
    ? Array.isArray(block.content)
      ? (block.content as readonly unknown[])
      : []
    : Array.isArray(message?.content)
      ? (message.content as readonly unknown[])
      : []
  const isError = block
    ? block.isError === true
    : message?.isError === true
  const error = failureIdentity(data.error)
  return {
    seq,
    time,
    content,
    isError,
    ...(error ? { error } : {}),
    ...(data.meta === undefined ? {} : { meta: data.meta }),
    resultView: viewFor(view, "result"),
  }
}
