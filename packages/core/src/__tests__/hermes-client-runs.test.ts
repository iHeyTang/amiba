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

  it("uses the named Profile route and task-scoped response mode", async () => {
    backplaneFetch.mockImplementation(async (path: string) => {
      if (path === "/p/researcher/v1/runs") {
        return Response.json(
          { run_id: "run_profile", status: "started" },
          { status: 202 },
        );
      }
      return new Response(
        'data: {"event":"run.completed","output":"done"}\n\n',
        { status: 200 },
      );
    });

    await runHermesAgent([{ role: "user", content: "Compare sources" }], {
      sessionId: "session-profile",
      agent: {
        profileId: "researcher",
        personality: {
          key: "concise",
          prompt: "Answer briefly.",
        },
      },
    });

    expect(backplaneFetch.mock.calls[0]?.[0]).toBe(
      "/p/researcher/v1/runs",
    );
    expect(backplaneFetch.mock.calls[1]?.[0]).toBe(
      "/p/researcher/v1/runs/run_profile/events",
    );
    expect(
      JSON.parse(String(backplaneFetch.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      session_id: "session-profile",
      instructions: "Answer briefly.",
    });
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

  it("forwards structured MoA lifecycle events", async () => {
    backplaneFetch.mockImplementation(async (path: string) => {
      if (path === "/v1/runs") {
        return new Response(
          JSON.stringify({ run_id: "run_moa", status: "started" }),
          { status: 202 },
        );
      }
      return new Response(
        [
          'data: {"event":"moa.progress","label":"openai/gpt-5","refs_done":1,"refs_total":2}',
          "",
          'data: {"event":"moa.phase","phase":"aggregator","aggregator":"anthropic/claude-opus-5","refs_done":2,"refs_total":2}',
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
    const onMoaEvent = vi.fn();

    await runHermesAgent(
      [{ role: "user", content: "Compare the proposals" }],
      { sessionId: "session-moa" },
      { onMoaEvent },
    );

    expect(onMoaEvent).toHaveBeenNthCalledWith(1, {
      kind: "progress",
      label: "openai/gpt-5",
      refsDone: 1,
      refsTotal: 2,
    });
    expect(onMoaEvent).toHaveBeenNthCalledWith(2, {
      kind: "phase",
      phase: "aggregator",
      aggregator: "anthropic/claude-opus-5",
      refsDone: 2,
      refsTotal: 2,
    });
  });
});
