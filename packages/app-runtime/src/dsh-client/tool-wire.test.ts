import { describe, expect, it } from "vitest"

import { projectRuntimeSessionHistory } from "../core/runtime-session-history"
import { DshAmibaEventBridge } from "./amiba-event-bridge"
import type { DshMuxFrame, DshSessionEvent } from "./index"
import type { ToolProgress, ToolWireRecord } from "../protocol"

/**
 * The `tool.call.toolview` seat is fed by TWO producers — the durable-log
 * projection (reload) and the live mux bridge (streaming). A field retained by
 * only one of them breaks the seat in half the cases, so every assertion here
 * runs against both over the SAME wire fixtures.
 */

const CALL_VIEW = {
  card: "terminal",
  title: "ls -la",
  cwd: "/repo",
} as const

const RESULT_VIEW = {
  card: "terminal",
  output: "total 240",
  exitCode: 0,
} as const

/** One `tool/call` event and its host-computed call-side view. */
function callEvent(): { event: DshSessionEvent; view: unknown } {
  return {
    event: {
      type: "tool/call",
      seq: 4,
      time: 1_000,
      data: {
        turn: 2,
        step: 3,
        callId: "call_1",
        name: "bash",
        arguments: '{"command":"ls -la"}',
      },
    },
    view: { for: "call", view: CALL_VIEW },
  }
}

/**
 * One `tool/result` event in the real DSH wire shape: the message's content is
 * exactly one `tool-result` block that owns the payload and the error flag.
 */
function resultEvent(options?: {
  isError?: boolean
  content?: unknown[]
  error?: unknown
  meta?: unknown
}): { event: DshSessionEvent; view: unknown } {
  return {
    event: {
      type: "tool/result",
      seq: 5,
      time: 1_250,
      data: {
        turn: 2,
        step: 3,
        ...(options?.error === undefined ? {} : { error: options.error }),
        ...(options?.meta === undefined ? {} : { meta: options.meta }),
        message: {
          role: "user",
          id: "m_1",
          source: { kind: "tool", callId: "call_1" },
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              isError: options?.isError ?? false,
              content: options?.content ?? [
                { type: "text", text: "total 240" },
              ],
            },
          ],
        },
      },
    },
    view: { for: "result", view: RESULT_VIEW },
  }
}

/** Fold events through the reload path and return the single tool row. */
function projected(
  entries: Array<{ event: DshSessionEvent; view?: unknown }>,
): ToolProgress {
  const messages = projectRuntimeSessionHistory([
    { event: { type: "turn/start", seq: 0, time: 1, data: { turn: 2 } } },
    ...entries,
  ])
  const assistant = messages.find((message) => message.role === "assistant")
  const rows = assistant?.toolProgress ?? []
  expect(rows).toHaveLength(1)
  return rows[0]!
}

/** Fold the same events through the live path and return the last tool row. */
function streamed(
  entries: Array<{ event: DshSessionEvent; view?: unknown }>,
): ToolProgress {
  const bridge = new DshAmibaEventBridge()
  let last: ToolProgress | undefined
  for (const entry of entries) {
    const frame: DshMuxFrame = {
      type: "session/event",
      sessionId: "s_1",
      event: entry.event,
      view: entry.view,
    }
    for (const bridged of bridge.accept({ rpcId: "r_1", payload: frame })) {
      if (bridged.event.kind === "toolProgress") last = bridged.event.event
    }
  }
  expect(last).toBeDefined()
  return last!
}

const PRODUCERS: Array<[string, (entries: Array<{ event: DshSessionEvent; view?: unknown }>) => ToolProgress]> = [
  ["reload projection", projected],
  ["live mux bridge", streamed],
]

describe.each(PRODUCERS)("%s retains tool wire material", (_name, fold) => {
  it("retains every call-side member of a running call", () => {
    const row = fold([callEvent()])

    expect(row.status).toBe("running")
    // Conveniences existing presenters read are untouched.
    expect(row.tool).toBe("bash")
    expect(row.args).toEqual({ command: "ls -la" })
    expect(row.wire?.call).toEqual({
      argsRaw: '{"command":"ls -la"}',
      turn: 2,
      step: 3,
      time: 1_000,
      callView: CALL_VIEW,
    })
    // Nothing result-shaped exists yet.
    expect(row.wire?.result).toBeUndefined()
  })

  it("retains both halves of a settled result", () => {
    const row = fold([callEvent(), resultEvent({ meta: { diff: "@@" } })])

    expect(row.status).toBe("completed")
    // Conveniences existing presenters read are untouched.
    expect(row.error).toBe(false)
    expect(row.result).toMatchObject({ text: "total 240" })
    // The call half survives the settle, so the block keeps its arguments.
    expect(row.wire?.call?.argsRaw).toBe('{"command":"ls -la"}')
    expect(row.wire?.call?.time).toBe(1_000)
    expect(row.wire?.result).toEqual({
      seq: 5,
      time: 1_250,
      content: [{ type: "text", text: "total 240" }],
      isError: false,
      meta: { diff: "@@" },
      resultView: RESULT_VIEW,
    })
  })

  it("retains the uncollapsed error flag and the failure identity", () => {
    const row = fold([
      callEvent(),
      resultEvent({
        isError: true,
        error: { name: "ToolExecutionError", code: "EXIT_1" },
        content: [{ type: "text", text: "boom" }],
      }),
    ])

    // The lossy convenience stays a boolean.
    expect(row.error).toBe(true)
    expect(row.wire?.result?.isError).toBe(true)
    expect(row.wire?.result?.error).toEqual({
      name: "ToolExecutionError",
      code: "EXIT_1",
    })
  })

  it("retains a non-text content block the flattened text cannot carry", () => {
    const imageBlock = {
      type: "image",
      attachment: { attachmentId: "att_1", mime: "image/png" },
    }
    const row = fold([
      callEvent(),
      resultEvent({ content: [imageBlock, { type: "text", text: "shot" }] }),
    ])

    // The flattening drops the image entirely — that is why the raw blocks
    // must survive beside it.
    expect(row.result).toMatchObject({ text: "shot" })
    expect(row.wire?.result?.content).toEqual([
      imageBlock,
      { type: "text", text: "shot" },
    ])
  })

  it("keeps the call half absent when only the result frame is in scope", () => {
    const row = fold([resultEvent()])

    expect(row.wire?.call).toBeUndefined()
    expect(row.wire?.result?.seq).toBe(5)
  })

  it("reports no render intent when the host computed none", () => {
    const row = fold([
      { event: callEvent().event },
      { event: resultEvent().event },
    ])

    const wire: ToolWireRecord | undefined = row.wire
    expect(wire?.call?.callView).toBeNull()
    expect(wire?.result?.resultView).toBeNull()
  })

  it("ignores a view frame whose `for` discriminant belongs to the other half", () => {
    const call = callEvent()
    const row = fold([
      { event: call.event, view: { for: "result", view: RESULT_VIEW } },
    ])

    expect(row.wire?.call?.callView).toBeNull()
  })
})
