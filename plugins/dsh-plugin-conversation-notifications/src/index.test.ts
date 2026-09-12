import { describe, it, expect, vi } from "vitest";
import { AmibaNotificationHub } from "@amiba/dsh-plugin-notification-hub";
import type { Context } from "@deepseek-ai/cordis";
import { apply, conversationNotificationListener } from "./index.js";
const setup = () => {
  const hub = new AmibaNotificationHub({
    logger: { warn: vi.fn() },
  } as unknown as Context);
  return { hub, event: conversationNotificationListener(hub) };
};
describe("conversation notifications", () => {
  it("publishes background turns and deduplicates delivery without replaying session history", () => {
    const { hub, event } = setup();
    const session = {
      id: "background",
      header: {},
      events: [{ type: "session/title", data: { title: "Ship release" } }],
    };
    const done = {
      type: "turn/end",
      data: { turn: 2, reason: { kind: "completed" } },
    };
    expect(hub.list()).toHaveLength(0);
    event(session, done);
    event(session, done);
    expect(hub.list()).toHaveLength(1);
    expect(hub.list()[0]).toMatchObject({
      title: "Ship release",
      sessionId: "background",
      status: "completed",
    });
    event(session, {
      type: "turn/end",
      data: { turn: 3, reason: { kind: "error" } },
    });
    expect(hub.list()[1].status).toBe("failed");
  });
  it("resolves only the matching approval and updates real titles", () => {
    const { hub, event } = setup();
    const session = { id: "s", header: { title: "Task" }, events: [] };
    event(session, { type: "approval/asked", data: { id: "a" } });
    event(session, { type: "approval/asked", data: { id: "b" } });
    event(session, { type: "approval/decided", data: { id: "a" } });
    expect(hub.list().filter((n) => !n.resolvedAt)).toHaveLength(1);
    const title = { type: "session/title", data: { title: "Renamed" } };
    event({ ...session, events: [title] }, title);
    expect(hub.list()[1].title).toBe("Renamed");
  });
  it("observes the real question tool lifetime without replacing its outcome", async () => {
    const { hub } = setup();
    const listeners = new Map<string, Function>();
    apply({
      amibaNotifications: hub,
      on: (name: string, fn: Function) => listeners.set(name, fn),
      logger: { warn: vi.fn() },
    } as unknown as Context);
    let release!: (value: string) => void;
    const result = listeners.get("tools/execute")!(
      {
        name: "ask_user_question",
        agent: { session: { id: "s", events: [] } },
      },
      () => new Promise<string>((r) => (release = r)),
    );
    expect(hub.list()[0].status).toBe("waiting");
    release("Answer");
    expect(await result).toBe("Answer");
    expect(hub.list()[0].resolvedAt).toBeDefined();
  });
});

describe("live conversation status", () => {
  it("tracks concurrent background turns, wire tool results and terminal cleanup", () => {
    const { hub, event } = setup();
    const a = { id: "a", header: { title: "First" }, events: [] };
    const b = { id: "b", header: { title: "Second" }, events: [] };
    event(a, { type: "turn/start", data: {} });
    event(b, { type: "turn/start", data: {} });
    event(a, { type: "tool/call", data: { callId: "one" } });
    event(a, { type: "tool/call", data: { callId: "two" } });
    event(a, { type: "tool/result", data: { message: { source: { callId: "one" } } } });
    expect(hub.list().find(n => n.sessionId === "a")?.status).toBe("tooling");
    event(a, { type: "tool/result", data: { message: { content: [{ type: "tool-result", toolCallId: "two" }] } } });
    event(a, { type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "Answer" } } });
    expect(hub.list().find(n => n.sessionId === "a")?.status).toBe("responding");
    event(a, { type: "turn/end", data: { turn: 1, reason: "completed" } });
    expect(hub.list().filter(n => n.activity).map(n => n.sessionId)).toEqual(["b"]);
    expect(hub.list().find(n => n.sessionId === "a")?.status).toBe("completed");
    event(b, { type: "turn/end", data: { turn: 1, reason: "error" } });
    expect(hub.list().some(n => n.activity)).toBe(false);
  });
  it("does not emit OS notices for execution, keeps read activity and avoids chunk churn", () => {
    const { hub, event } = setup(), sink = vi.fn();
    hub.registerSink(sink);
    const a = { id: "a", header: { title: "Task" }, events: [] };
    event(a, { type: "turn/start", data: {} });
    const cursor = hub.updates(null).cursor;
    event(a, { type: "assistant/chunk", data: { chunk: { type: "reasoning-delta" } } });
    expect(hub.updates(cursor).notifications).toEqual([]);
    hub.markSessionsRead([{ sessionId: "a", readAt: Date.now() }]);
    hub.dismiss(hub.list()[0].id);
    expect(hub.list()[0]).toMatchObject({ activity: true, status: "thinking" });
    expect(hub.list()[0].readAt).toBeUndefined();
    expect(hub.list()[0].dismissedAt).toBeUndefined();
    expect(sink).not.toHaveBeenCalled();
  });
});

it("keeps unresolved approvals in live status after reading and restores execution after decisions", () => {
  const { hub, event } = setup();
  const session = { id: "waiting", header: { title: "Task" }, events: [] };
  event(session, { type: "turn/start", data: {} });
  event(session, { type: "approval/asked", data: { id: "a" } });
  event(session, { type: "approval/asked", data: { id: "b" } });
  hub.markSessionsRead([{ sessionId: "waiting", readAt: Date.now() }]);
  event(session, { type: "approval/decided", data: { id: "a" } });
  expect(hub.list().find(n => n.activity)?.status).toBe("waiting");
  event(session, { type: "approval/decided", data: { id: "b" } });
  expect(hub.list().find(n => n.activity)?.status).toBe("thinking");
  event(session, { type: "tool/call", data: { callId: "q", name: "ask_user_question" } });
  expect(hub.list().find(n => n.activity)?.status).toBe("waiting");
  event(session, { type: "tool/result", data: { message: { toolCallId: "q" } } });
  expect(hub.list().find(n => n.activity)?.status).toBe("thinking");
});
