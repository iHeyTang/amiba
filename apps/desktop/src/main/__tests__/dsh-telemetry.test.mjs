import assert from "node:assert/strict";
import test from "node:test";

const { DshTelemetryProjector } = await import("../dsh-telemetry.ts");

function frame(sessionId, type, seq, data, time = 1_000 + seq * 10) {
  return {
    rpcId: `rpc-${seq}`,
    payload: {
      type: "session/event",
      sessionId,
      event: { type, seq, time, data },
    },
  };
}

test("projects every DSH tool lifecycle with stable correlation", () => {
  const projector = new DshTelemetryProjector();
  assert.deepEqual(
    projector.accept(
      frame("s-1", "tool/call", 1, {
        turn: 2,
        step: 0,
        callId: "call-1",
        name: "read",
        arguments: "{}",
      }),
    ),
    [
      {
        event: "tool.started",
        payload: {
          sessionId: "s-1",
          runId: "s-1:2",
          tool: "read",
          toolCallId: "call-1",
          startedAt: 1010,
        },
      },
    ],
  );
  assert.deepEqual(
    projector.accept(
      frame("s-1", "tool/result", 2, {
        turn: 2,
        step: 0,
        message: { toolCallId: "call-1", content: [] },
      }),
    ),
    [
      {
        event: "tool.completed",
        payload: {
          sessionId: "s-1",
          runId: "s-1:2",
          tool: "read",
          toolCallId: "call-1",
          startedAt: 1010,
          durationMs: 10,
        },
      },
    ],
  );
});

test("publishes one aggregated run.completed event at the DSH turn boundary", () => {
  const projector = new DshTelemetryProjector();
  projector.accept(
    frame("s-2", "request/context", 1, {
      turn: 3,
      step: 0,
      provider: "deepseek",
      model: "deepseek-chat",
    }),
  );
  projector.accept(
    frame("s-2", "assistant/message", 2, {
      turn: 3,
      step: 0,
      message: { role: "assistant", content: [] },
      usage: {
        inputTokens: 10,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        outputTokens: 5,
      },
    }),
  );
  assert.deepEqual(
    projector.accept(
      frame("s-2", "turn/end", 3, { turn: 3, reason: { kind: "success" } }),
    ),
    [
      {
        event: "run.completed",
        payload: {
          sessionId: "s-2",
          model: "deepseek-chat",
          usage: {
            prompt_tokens: 15,
            completion_tokens: 5,
            total_tokens: 20,
          },
        },
      },
    ],
  );
});
