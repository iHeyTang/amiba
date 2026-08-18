import { describe, expect, it, vi } from "vitest";

import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";

import { scheduleDispatchListener, schedulePromptOf } from "./notify.js";

function changeEvent(data: Record<string, unknown>): SessionEvent {
  return { type: "schedule/change", data } as unknown as SessionEvent;
}

function createEvent(id: string, prompt: string): SessionEvent {
  return changeEvent({
    version: 1,
    operation: "create",
    schedule: { id, kind: "after", prompt, afterSeconds: 60, scheduledAt: "" },
  });
}

function dispatchEvent(id: string): SessionEvent {
  return changeEvent({ version: 1, operation: "dispatch", id });
}

function sessionWith(events: SessionEvent[]): Session {
  return { id: "sess-1", events } as unknown as Session;
}

describe("schedulePromptOf", () => {
  it("finds the creating record's prompt for a dispatched id", () => {
    const events = [
      createEvent("a", "water the plants"),
      createEvent("b", "check the backup"),
    ];
    expect(schedulePromptOf(events, "b")).toBe("check the backup");
    expect(schedulePromptOf(events, "missing")).toBeUndefined();
  });

  it("ignores non-schedule events and malformed change payloads", () => {
    const events = [
      { type: "user/message", data: { id: "x" } } as unknown as SessionEvent,
      changeEvent({ operation: "create" }),
      changeEvent({ operation: "create", schedule: "not-an-object" }),
    ];
    expect(schedulePromptOf(events, "a")).toBeUndefined();
  });
});

describe("scheduleDispatchListener", () => {
  it("posts an info notification when a schedule dispatch is appended", () => {
    const post = vi.fn();
    const warn = vi.fn();
    const listener = scheduleDispatchListener(post, warn);
    const session = sessionWith([createEvent("a", "  water   the plants  ")]);

    listener(session, dispatchEvent("a"));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      title: "water the plants",
      kind: "info",
      sessionId: "sess-1",
      source: "schedule-adapter",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("bounds an over-long prompt for the notification title", () => {
    const post = vi.fn();
    const listener = scheduleDispatchListener(post, vi.fn());
    const session = sessionWith([createEvent("a", "p".repeat(400))]);

    listener(session, dispatchEvent("a"));

    const title = post.mock.calls[0]![0].title as string;
    expect(title.length).toBe(120);
    expect(title.endsWith("…")).toBe(true);
  });

  it("ignores non-dispatch and unrelated events", () => {
    const post = vi.fn();
    const listener = scheduleDispatchListener(post, vi.fn());
    const session = sessionWith([createEvent("a", "hello")]);

    listener(session, createEvent("a", "hello"));
    listener(session, {
      type: "turn/end",
      data: { turn: 1 },
    } as unknown as SessionEvent);
    listener(session, changeEvent({ operation: "dispatch", id: 42 }));

    expect(post).not.toHaveBeenCalled();
  });

  it("skips dispatches whose creating record cannot be found", () => {
    const post = vi.fn();
    const warn = vi.fn();
    const listener = scheduleDispatchListener(post, warn);

    listener(sessionWith([]), dispatchEvent("ghost"));

    expect(post).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("contains a failing post as a warning", () => {
    const post = vi.fn(() => {
      throw new Error("hub rejected");
    });
    const warn = vi.fn();
    const listener = scheduleDispatchListener(post, warn);
    const session = sessionWith([createEvent("a", "hello")]);

    expect(() => listener(session, dispatchEvent("a"))).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("hub rejected");
  });
});
