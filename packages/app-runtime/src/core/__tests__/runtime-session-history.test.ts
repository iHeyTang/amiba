import { describe, expect, it } from "vitest";

import { projectRuntimeSessionHistory } from "../runtime-session-history";

describe("projectRuntimeSessionHistory", () => {
  it("folds a DSH event log into one assistant row per turn", () => {
    const messages = projectRuntimeSessionHistory([
      { event: { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } },
      {
        event: {
          type: "user/message",
          seq: 1,
          time: 2,
          data: {
            id: "u1",
            source: { kind: "user" },
            content: [{ type: "text", text: "inspect" }],
          },
        },
      },
      {
        event: {
          type: "tool/call",
          seq: 2,
          time: 3,
          data: { callId: "c1", name: "read", arguments: '{"path":"a"}' },
        },
      },
      {
        event: {
          type: "tool/result",
          seq: 3,
          time: 8,
          data: {
            message: {
              toolCallId: "c1",
              content: [{ type: "text", text: "ok" }],
            },
          },
        },
      },
      {
        event: {
          type: "assistant/message",
          seq: 4,
          time: 9,
          data: {
            message: { content: [{ type: "text", text: "done" }] },
          },
        },
      },
      {
        event: {
          type: "turn/end",
          seq: 5,
          time: 10,
          data: { turn: 1, reason: { kind: "completed" } },
        },
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "inspect" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "done",
      toolProgress: [
        {
          tool: "read",
          toolCallId: "c1",
          status: "completed",
          args: { path: "a" },
          durationMs: 5,
        },
      ],
    });
  });

  it("completes tools from the real DSH wire shape (source.callId + nested tool-result)", () => {
    const messages = projectRuntimeSessionHistory([
      { event: { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } } },
      {
        event: {
          type: "tool/call",
          seq: 1,
          time: 100,
          data: { callId: "call_00_x", name: "bash", arguments: "{}" },
        },
      },
      {
        event: {
          type: "tool/result",
          seq: 2,
          time: 350,
          data: {
            turn: 1,
            step: 1,
            message: {
              role: "tool",
              id: "m1",
              source: { kind: "tool", callId: "call_00_x" },
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call_00_x",
                  content: [{ type: "text", text: "total 240" }],
                },
              ],
            },
          },
        },
      },
      {
        event: {
          type: "assistant/message",
          seq: 3,
          time: 400,
          data: { message: { content: [{ type: "text", text: "done" }] } },
        },
      },
      {
        event: {
          type: "turn/end",
          seq: 4,
          time: 500,
          data: { turn: 1, reason: { kind: "completed" } },
        },
      },
    ]);

    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.toolProgress).toMatchObject([
      {
        toolCallId: "call_00_x",
        status: "completed",
        durationMs: 250,
        result: { text: "total 240" },
      },
    ]);
  });

  it("projects DSH command-plane lifecycle records without inventing a model turn", () => {
    const messages = projectRuntimeSessionHistory([
      {
        event: {
          type: "command/run",
          seq: 1,
          time: 1,
          data: { commandId: "cmd-1", name: "plan", args: " inspect auth" },
        },
      },
      {
        event: {
          type: "command/done",
          seq: 2,
          time: 2,
          data: { commandId: "cmd-1", kind: "success", text: "Plan mode enabled" },
        },
      },
    ]);

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "/plan inspect auth" }),
      expect.objectContaining({ role: "assistant", content: "Plan mode enabled" }),
    ]);
  });
});
