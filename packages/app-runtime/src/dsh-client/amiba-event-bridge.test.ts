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

  it("maps a plugin-dispatched user message, and ignores the user's own", () => {
    const bridge = new DshAmibaEventBridge()
    const userMessage = (data: Record<string, unknown>): DshMuxEnvelope => ({
      rpcId: "rpc",
      payload: {
        type: "session/event",
        sessionId: "s",
        event: { type: "user/message", seq: 7, time: 10, data },
      },
    })

    expect(
      bridge.accept(
        userMessage({
          id: "m1",
          source: { kind: "plugin", plugin: "amiba-steward", form: "relay" },
          content: [{ type: "text", text: "帮我看下这个任务" }],
        }),
      )[0]?.event,
    ).toEqual({
      kind: "userMessage",
      // The very id the durable-log projection derives, so the live bubble
      // and the reloaded one collide instead of appearing twice.
      uiId: "dsh:m1",
      content: "帮我看下这个任务",
      origin: { kind: "plugin", plugin: "amiba-steward" },
    })

    // The composer already put the person's own message on screen.
    expect(
      bridge.accept(
        userMessage({
          id: "m2",
          source: { kind: "user" },
          content: [{ type: "text", text: "hi" }],
        }),
      ),
    ).toEqual([])
    // Injected model context is not conversation.
    expect(
      bridge.accept(
        userMessage({
          id: "m3",
          source: { kind: "plugin", plugin: "ctx", form: "snapshot" },
          content: [{ type: "text", text: "state" }],
        }),
      ),
    ).toEqual([])
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
