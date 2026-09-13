import { expect, it, vi } from "vitest";
import { WeixinProgress } from "./progress.js";
it("orders native progress, preserves failure status and excludes arguments/results", async () => {
  const send = vi.fn(async () => {});
  const relay = new WeixinProgress(async () => ({ progress: send }) as never);
  relay.accept("session", {
    time: 1,
    type: "tool/call",
    data: { callId: "call", name: "read", arguments: "private-input" },
  } as never);
  relay.accept("session", {
    time: 2,
    type: "tool/result",
    data: {
      message: {
        source: { callId: "call" },
        content: [
          { toolCallId: "call", isError: true, content: "private-output" },
        ],
      },
    },
  } as never);
  await relay.drain();
  expect(send.mock.calls).toMatchObject([
    [
      { type: 11, tool_call_start_item: { tool_name: "read" } },
      "session:call:start",
    ],
    [
      { type: 12, tool_call_result_item: { status: "failed" } },
      "session:call:end",
    ],
  ]);
  expect(JSON.stringify(send.mock.calls)).not.toContain("private");
});
it("ignores unrelated sessions and stops queued work on dispose", async () => {
  const resolve = vi.fn(async () => {
    throw new Error("not_weixin");
  });
  const relay = new WeixinProgress(resolve);
  relay.accept("desktop", {
    type: "tool/call",
    data: { callId: "call", name: "read" },
  } as never);
  await relay.drain();
  expect(resolve).toHaveBeenCalledOnce();
  relay.dispose();
  relay.accept("desktop", { type: "tool/call" } as never);
  await relay.drain();
  expect(resolve).toHaveBeenCalledOnce();
});
