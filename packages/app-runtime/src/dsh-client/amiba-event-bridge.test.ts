import { describe, expect, it } from "vitest"
import { DshAmibaEventBridge } from "./amiba-event-bridge"
import type { DshMuxEnvelope } from "./index"

describe("DshAmibaEventBridge", () => {
  it("maps native DSH chunks and tool lifecycle", () => {
    const bridge = new DshAmibaEventBridge()
    const frame = (event: DshMuxEnvelope["payload"]): DshMuxEnvelope => ({
      rpcId: "rpc",
      payload: event,
    })
    expect(
      bridge.accept(
        frame({
          type: "session/event",
          sessionId: "s",
          event: {
            type: "assistant/chunk",
            seq: 1,
            time: 10,
            data: { chunk: { type: "text-delta", index: 0, text: "hi" } },
          },
        }),
      )[0]?.event,
    ).toEqual({ kind: "chunk", text: "hi" })

    const started = bridge.accept(
      frame({
        type: "session/event",
        sessionId: "s",
        event: {
          type: "tool/call",
          seq: 2,
          time: 20,
          data: { callId: "c", name: "bash", arguments: '{"command":"pwd"}' },
        },
        view: { for: "call", view: { card: "terminal", title: "pwd" } },
      }),
    )[0]?.event
    expect(started).toMatchObject({
      kind: "toolProgress",
      event: { tool: "bash", toolCallId: "c", status: "running", label: "pwd" },
    })

    const completed = bridge.accept(
      frame({
        type: "session/event",
        sessionId: "s",
        event: {
          type: "tool/result",
          seq: 3,
          time: 45,
          data: {
            message: {
              toolCallId: "c",
              content: [{ type: "text", text: "/tmp" }],
            },
          },
        },
      }),
    )[0]?.event
    expect(completed).toMatchObject({
      kind: "toolProgress",
      event: { toolCallId: "c", status: "completed", durationMs: 25 },
    })
  })

  it("preserves DSH rpcId for answerable frames", () => {
    const bridge = new DshAmibaEventBridge()
    const approval = bridge.accept({
      rpcId: "approval-rpc",
      payload: {
        type: "approval/requested",
        sessionId: "s",
        approvalId: "a",
        toolName: "bash",
      },
    })[0]?.event
    expect(approval).toMatchObject({
      kind: "approvalRequest",
      request: { requestId: "approval-rpc", approvalId: "a" },
    })
  })
})
