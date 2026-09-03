import { describe, expect, it } from "vitest";

import {
  ASK_USER_TOOL,
  completedTurns,
  describeTurnEndReason,
  lastSeq,
  pendingAskUser,
} from "./reply-fold.js";

type Ev = { type: string; seq: number; time: number; data: Record<string, unknown> };
let seq = 0;
const ev = (type: string, data: Record<string, unknown>): Ev => ({ type, seq: seq++, time: 1000 + seq, data });
const user = (text: string) => ev("user/message", { id: `u${seq}`, role: "user", content: [{ type: "text", text }] });
const assistant = (turn: number, text: string) =>
  ev("assistant/message", { turn, step: 0, message: { id: `a${seq}`, role: "assistant", content: [{ type: "text", text }] } });

describe("completedTurns", () => {
  it("folds each finished turn into user text, assistant text and outcome", () => {
    seq = 0;
    const events = [
      ev("turn/start", { turn: 0 }),
      user("do A"),
      assistant(0, "part 1"),
      assistant(0, "part 2"),
      ev("turn/end", { turn: 0, reason: { kind: "completed" } }),
      ev("turn/start", { turn: 1 }),
      user("do B"),
      ev("turn/end", { turn: 1, reason: { kind: "error", error: { message: "boom" } } }),
    ];
    const turns = completedTurns(events as never, -1);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turn: 0, userText: "do A", assistantText: "part 1\n\npart 2", failed: false, endSeq: 4 });
    expect(turns[1]).toMatchObject({ turn: 1, userText: "do B", assistantText: "", failed: true });
    expect(describeTurnEndReason(turns[1]!.reason)).toBe("error: boom");
  });

  it("skips turns already reported and open turns", () => {
    seq = 0;
    const events = [
      ev("turn/start", { turn: 0 }),
      user("x"),
      ev("turn/end", { turn: 0, reason: { kind: "completed" } }),
      ev("turn/start", { turn: 1 }),
      user("y"),
    ];
    expect(completedTurns(events as never, 2)).toEqual([]);
    expect(completedTurns(events as never, 1)).toHaveLength(1);
    expect(lastSeq(events as never)).toBe(4);
    expect(lastSeq([])).toBe(-1);
  });
});

describe("pendingAskUser", () => {
  it("finds an ask_user_question call without a matching result", () => {
    seq = 0;
    const events = [
      ev("tool/call", { turn: 0, step: 0, callId: "c1", name: ASK_USER_TOOL, arguments: "{}" }),
    ];
    expect(pendingAskUser(events as never)).toEqual({ callId: "c1", seq: 0 });
    events.push(
      ev("tool/result", { turn: 0, step: 0, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [] }] } }),
    );
    expect(pendingAskUser(events as never)).toBeNull();
  });

  it("ignores other tools", () => {
    seq = 0;
    const events = [ev("tool/call", { turn: 0, step: 0, callId: "c2", name: "bash", arguments: "{}" })];
    expect(pendingAskUser(events as never)).toBeNull();
  });

  it("skips an answered later call and returns an earlier unanswered one in the same open turn", () => {
    seq = 0;
    const events = [
      ev("tool/call", { turn: 0, step: 0, callId: "c1", name: ASK_USER_TOOL, arguments: "{}" }),
      ev("tool/call", { turn: 0, step: 0, callId: "c2", name: ASK_USER_TOOL, arguments: "{}" }),
      ev("tool/result", { turn: 0, step: 0, message: { content: [{ type: "tool-result", toolCallId: "c2", content: [] }] } }),
    ];
    expect(pendingAskUser(events as never)).toEqual({ callId: "c1", seq: 0 });
  });

  it("treats an unanswered call as settled once its turn has ended", () => {
    seq = 0;
    const events = [
      ev("turn/start", { turn: 0 }),
      ev("tool/call", { turn: 0, step: 0, callId: "c1", name: ASK_USER_TOOL, arguments: "{}" }),
      ev("turn/end", { turn: 0, reason: { kind: "aborted" } }),
    ];
    expect(pendingAskUser(events as never)).toBeNull();
    events.push(ev("tool/call", { turn: 1, step: 0, callId: "c3", name: ASK_USER_TOOL, arguments: "{}" }));
    expect(pendingAskUser(events as never)).toEqual({ callId: "c3", seq: 3 });
  });
});
