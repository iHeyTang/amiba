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
    // A `notice` is an ACCOUNT, not a turn: it reaches the surface with its
    // summary so the surface can collapse it into a context row — the same
    // shape the durable-log projection produces, under the same id.
    expect(
      bridge.accept(
        userMessage({
          id: "m3n",
          source: {
            kind: "plugin",
            plugin: "repeat-tool-reminder",
            form: "notice",
            summary: "amiba_browser_click × 5",
          },
          content: [{ type: "text", text: "You are repeating the exact same tool call" }],
        }),
      )[0]?.event,
    ).toEqual({
      kind: "userMessage",
      uiId: "dsh:m3n",
      content: "You are repeating the exact same tool call",
      origin: { kind: "plugin", plugin: "repeat-tool-reminder" },
      notice: { summary: "amiba_browser_click × 5" },
    })
    // A notice with no summary has nothing to show collapsed — malformed.
    expect(
      bridge.accept(
        userMessage({
          id: "m3s",
          source: { kind: "plugin", plugin: "repeat-tool-reminder", form: "notice" },
          content: [{ type: "text", text: "no summary" }],
        }),
      ),
    ).toEqual([])
    // A plugin source with no name cannot be attributed — dropped here and
    // dropped by the projection, so it never appears on reload either.
    expect(
      bridge.accept(
        userMessage({
          id: "m4",
          source: { kind: "plugin", form: "relay" },
          content: [{ type: "text", text: "anonymous" }],
        }),
      ),
    ).toEqual([])
  })

  it("strips attachment envelopes exactly as the durable projection does", () => {
    const bridge = new DshAmibaEventBridge()
    const event = bridge.accept({
      rpcId: "rpc",
      payload: {
        type: "session/event",
        sessionId: "s",
        event: {
          type: "user/message",
          seq: 1,
          time: 10,
          data: {
            id: "m1",
            source: { kind: "plugin", plugin: "amiba-im", form: "relay" },
            content: [
              {
                type: "text",
                text:
                  "<file-attachment>\n" +
                  'Name: "shot.png"\n' +
                  'Kind: "image"\n' +
                  'Mime: "image/png"\n' +
                  "Size: 12 bytes\n" +
                  'Attachment-ID: "att_9"\n' +
                  "</file-attachment>\n\n" +
                  "看看这个",
              },
            ],
          },
        },
      },
    } as unknown as DshMuxEnvelope)[0]?.event
    // The identical wire shape yields the identical cleaned text from the
    // projection — see "strips an attachment envelope from a plugin-relayed
    // message too" in runtime-session-history.test.ts.
    expect(event).toMatchObject({ kind: "userMessage", content: "看看这个" })
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
