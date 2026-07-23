import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import { runHermesAgent } from "../hermes-client";

describe("runHermesAgent workspace cwd", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
    backplaneFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/runs") {
        return new Response(
          JSON.stringify({ run_id: "run_workspace", status: "started" }),
          {
            status: 202,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        'data: {"event":"run.completed","output":"done"}\n\n',
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    });
  });

  it("sends the selected workspace as structured cwd", async () => {
    await runHermesAgent(
      [{ role: "user", content: "Inspect this repo" }],
      {
        sessionId: "session-1",
        model: "test-model",
        workingDirectory: "/workspaces/hermes-x",
      },
    );

    const [, init] = backplaneFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      session_id: "session-1",
      cwd: "/workspaces/hermes-x",
    });
  });

  it("omits cwd when no workspace is bound", async () => {
    await runHermesAgent([{ role: "user", content: "Hello" }], {
      sessionId: "session-2",
    });

    const [, init] = backplaneFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("cwd");
  });

  it("forwards structured tool lifecycle details", async () => {
    backplaneFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/runs") {
        return new Response(
          JSON.stringify({ run_id: "run_tools", status: "started" }),
          { status: 202 },
        );
      }
      return new Response(
        [
          'data: {"event":"tool.started","tool":"terminal","tool_call_id":"call_1","preview":"pnpm test","args":{"command":"pnpm test","workdir":"/repo"}}',
          "",
          'data: {"event":"tool.completed","tool":"terminal","tool_call_id":"call_1","duration":1.25,"error":false,"args":{"command":"pnpm test","workdir":"/repo"},"result":{"output":"passed","exit_code":0}}',
          "",
          'data: {"event":"run.completed","output":"done"}',
          "",
        ].join("\n"),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    });
    const onToolStarted = vi.fn();
    const onToolCompleted = vi.fn();

    await runHermesAgent(
      [{ role: "user", content: "Run tests" }],
      { sessionId: "session-tools" },
      { onToolStarted, onToolCompleted },
    );

    expect(onToolStarted).toHaveBeenCalledWith({
      tool: "terminal",
      toolCallId: "call_1",
      preview: "pnpm test",
      args: { command: "pnpm test", workdir: "/repo" },
    });
    expect(onToolCompleted).toHaveBeenCalledWith({
      tool: "terminal",
      toolCallId: "call_1",
      duration: 1.25,
      error: false,
      args: { command: "pnpm test", workdir: "/repo" },
      result: { output: "passed", exit_code: 0 },
      inlineDiff: undefined,
    });
  });
});
