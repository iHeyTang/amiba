import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { describe, expect, it } from "vitest";

import { toolActivityDayKey } from "./tool-activity.js";
import { ToolActivityRecorder } from "./tool-activity-recorder.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "amiba-tool-activity-"));
}

function toolCall(
  time: number,
  callId: string,
  name: string,
  turn: number | undefined,
): SessionEvent {
  return {
    seq: 0,
    time,
    type: "tool/call",
    data: { turn, step: 0, callId, name, arguments: "{}" },
  } as unknown as SessionEvent;
}

function toolResult(time: number, callId: string): SessionEvent {
  return {
    seq: 1,
    time,
    type: "tool/result",
    data: {
      turn: 0,
      step: 0,
      message: {
        role: "user",
        content: [
          { type: "tool-result", toolCallId: callId, content: [], isError: false },
        ],
        source: { kind: "tool", callId },
      },
    },
  } as unknown as SessionEvent;
}

describe("ToolActivityRecorder", () => {
  it("records a started row for tool/call and completes it with a duration on tool/result", async () => {
    const recorder = new ToolActivityRecorder(await tempRoot());
    const start = Date.now();

    recorder.accept("session-a", toolCall(start, "call-1", "search", 3));
    recorder.accept("session-a", toolResult(start + 250, "call-1"));

    const result = await recorder.read(1);
    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.day).toBe(toolActivityDayKey(start));
    expect(result.days[0]!.rows).toEqual([
      {
        ts: start,
        sessionId: "session-a",
        runId: "session-a:3",
        tool: "search",
        toolCallId: "call-1",
        durationMs: 250,
        completed: true,
      },
    ]);
    expect(result.lifetime).toEqual({
      calls: 1,
      distinctTools: 0,
      totalDurationMs: 250,
      unfinished: 0,
    });
  });

  it("scopes completion to the session when call ids collide across sessions", async () => {
    const recorder = new ToolActivityRecorder(await tempRoot());
    const start = Date.now();

    recorder.accept("session-a", toolCall(start, "call-1", "search", 1));
    recorder.accept("session-b", toolCall(start + 10, "call-1", "bash", 1));
    recorder.accept("session-b", toolResult(start + 60, "call-1"));

    const rows = (await recorder.read(1)).days[0]!.rows;
    expect(rows.find((r) => r.sessionId === "session-a")).toMatchObject({
      completed: false,
    });
    expect(rows.find((r) => r.sessionId === "session-b")).toMatchObject({
      completed: true,
      durationMs: 50,
    });
  });

  it("keeps an uncompleted call as unfinished with no duration", async () => {
    const recorder = new ToolActivityRecorder(await tempRoot());
    const start = Date.now();

    recorder.accept("session-a", toolCall(start, "call-1", "shell", 0));

    const result = await recorder.read(1);
    expect(result.days[0]!.rows[0]).toMatchObject({
      tool: "shell",
      completed: false,
    });
    expect(result.days[0]!.rows[0]!.durationMs).toBeUndefined();
    expect(result.lifetime.calls).toBe(1);
    expect(result.lifetime.unfinished).toBe(1);
  });

  it("ignores tool/call events without a callId or turn and unmatched tool/result events", async () => {
    const recorder = new ToolActivityRecorder(await tempRoot());
    const start = Date.now();

    recorder.accept("session-a", toolCall(start, "", "search", 0));
    recorder.accept("session-a", toolCall(start, "call-x", "search", undefined));
    recorder.accept("session-a", toolResult(start + 10, "never-started"));

    const result = await recorder.read(1);
    expect(result.days[0]!.rows).toEqual([]);
    expect(result.lifetime.calls).toBe(0);
  });

  it("completes a row persisted by a previous process without inventing a duration", async () => {
    const root = await tempRoot();
    const start = Date.now();

    const first = new ToolActivityRecorder(root);
    first.accept("session-a", toolCall(start, "call-1", "search", 0));
    await first.read(1); // flush

    // New instance = runtime restart: the in-memory start map is gone.
    const second = new ToolActivityRecorder(root);
    second.accept("session-a", toolResult(start + 500, "call-1"));

    const result = await second.read(1);
    expect(result.days[0]!.rows[0]).toMatchObject({ completed: true });
    expect(result.days[0]!.rows[0]!.durationMs).toBeUndefined();
    expect(result.lifetime.unfinished).toBe(0);
  });

  it("caps the read window and returns exactly the requested day buckets, newest first", async () => {
    const recorder = new ToolActivityRecorder(await tempRoot());
    const result = await recorder.read(3);
    expect(result.days.map((d) => d.day)).toEqual([
      toolActivityDayKey(Date.now()),
      toolActivityDayKey(Date.now() - 24 * 60 * 60 * 1000),
      toolActivityDayKey(Date.now() - 2 * 24 * 60 * 60 * 1000),
    ]);
    const capped = await recorder.read(0);
    expect(capped.days).toHaveLength(1);
  });

  it("persists day buckets as JSON files under the configured root", async () => {
    const root = await tempRoot();
    const recorder = new ToolActivityRecorder(root);
    const start = Date.now();
    recorder.accept("session-a", toolCall(start, "call-1", "search", 0));
    await recorder.read(1); // flush

    const raw = await readFile(
      path.join(root, `${toolActivityDayKey(start)}.json`),
      "utf8",
    );
    expect(JSON.parse(raw)).toHaveLength(1);
  });
});
