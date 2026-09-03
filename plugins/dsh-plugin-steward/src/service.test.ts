import { describe, expect, it, vi } from "vitest";

import { DISPATCH_FOOTER } from "./service.js";
import { harness } from "./test/service-harness.js";

describe("StewardService — steward session", () => {
  it("creates the steward session once with its preset and runs the setup hook", async () => {
    const { service, store, created, ctx, onStewardSetup, setupCtxs } = harness();
    const id = await service.ensureStewardSessionId();
    expect(id).toMatch(/^session-/u);
    expect(created).toEqual([{ sessionId: id, meta: { cwd: "/default", agentPreset: "amiba-steward" } }]);
    expect(ctx.agentPresets.mount).toHaveBeenCalledWith(setupCtxs.get(id), "amiba-steward");
    expect(onStewardSetup).toHaveBeenCalledWith(setupCtxs.get(id));
    expect((await store.read()).stewardSessionId).toBe(id);
    expect(await service.ensureStewardSessionId()).toBe(id);
    expect(created).toHaveLength(1);
  });

  it("resumes a persisted steward session on start and recreates it when unloadable", async () => {
    const first = harness();
    const id = await first.service.ensureStewardSessionId();
    first.service.dispose();

    const second = harness();
    await second.store.mutate((s) => ({ ...s, stewardSessionId: id }));
    second.persist(id, [], { agentPreset: "amiba-steward" });
    await second.service.start();
    expect(second.resumed).toEqual([id]);
    expect(await second.service.ensureStewardSessionId()).toBe(id);

    const third = harness();
    await third.store.mutate((s) => ({ ...s, stewardSessionId: "session-gone" }));
    await third.service.start();
    const fresh = await third.service.ensureStewardSessionId();
    expect(fresh).not.toBe("session-gone");
    expect(third.created).toHaveLength(1);
  });
});

describe("StewardService — dispatch", () => {
  it("creates a task session for a new task, guards ask_user_question, and follows up the message", async () => {
    const { service, created, live, setupCtxs, ctx } = harness();
    const result = await service.dispatch({ newTask: { title: "写周报" }, message: "帮我写这周的周报" });
    expect(result.created).toBe(true);
    const task = (await service.listTasks())[0]!;
    expect(task).toMatchObject({ id: result.taskId, title: "写周报", sessionId: result.sessionId, cwd: "/default", origin: "created", status: "running", lastReportedSeq: -1 });
    expect(created.find((c) => c.sessionId === result.sessionId)?.meta).toEqual({ cwd: "/default" });
    expect(ctx.agentPresets.mount).toHaveBeenCalledWith(setupCtxs.get(result.sessionId), undefined);
    expect(setupCtxs.get(result.sessionId)!.tools.guard).toHaveBeenCalledTimes(1);
    const guard = setupCtxs.get(result.sessionId)!.tools.guard.mock.calls[0]![0] as (e: { name: string }) => string | undefined;
    expect(guard({ name: "ask_user_question" })).toMatch(/steward/u);
    expect(guard({ name: "bash" })).toBeUndefined();
    const message = live.get(result.sessionId)!.followup.mock.calls[0]![0] as { content: Array<{ text: string }>; source: Record<string, unknown> };
    expect(message.content[0]!.text).toBe(`帮我写这周的周报\n\n${DISPATCH_FOOTER}`);
    expect(message.source).toEqual({ kind: "plugin", plugin: "amiba-steward", form: "relay" });
  });

  it("dispatches to an existing task by resuming its cold session, and reuses the live agent afterwards", async () => {
    const { service, live, resumed } = harness();
    const first = await service.dispatch({ newTask: { title: "A", cwd: "/repo" }, message: "start" });
    live.delete(first.sessionId); // simulate the agent retiring
    const second = await service.dispatch({ taskId: first.taskId, message: "continue" });
    expect(second).toEqual({ taskId: first.taskId, sessionId: first.sessionId, created: false });
    expect(resumed).toEqual([first.sessionId]);
    await service.dispatch({ taskId: first.taskId, message: "again" });
    expect(resumed).toHaveLength(1);
    expect(live.get(first.sessionId)!.followup).toHaveBeenCalledTimes(2);
  });

  it("marks the task failed and throws when the session cannot be resumed", async () => {
    const { service, live, persisted } = harness();
    const first = await service.dispatch({ newTask: { title: "A" }, message: "start" });
    live.delete(first.sessionId);
    persisted.delete(first.sessionId);
    await expect(service.dispatch({ taskId: first.taskId, message: "x" })).rejects.toThrow(/session_not_found/u);
    const task = (await service.listTasks())[0]!;
    expect(task.status).toBe("failed");
    expect(task.lastError).toMatch(/session_not_found/u);
  });

  it("rejects malformed input", async () => {
    const { service } = harness();
    await expect(service.dispatch({ message: "x" })).rejects.toThrow(/taskId or newTask/u);
    await expect(service.dispatch({ taskId: "nope", message: "x" })).rejects.toThrow(/unknown task/u);
    await expect(service.dispatch({ newTask: { title: " " }, message: "x" })).rejects.toThrow(/title/u);
    await expect(service.dispatch({ newTask: { title: "t" }, message: " " })).rejects.toThrow(/message/u);
  });
});

describe("StewardService — adopt / read / close", () => {
  it("adopts a persisted session by id, idempotently, starting reports from its current tail", async () => {
    const { service, persist } = harness();
    persist("session-x", [
      { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } },
      { type: "turn/end", seq: 1, time: 2, data: { turn: 0, reason: { kind: "completed" } } },
    ]);
    const first = await service.adopt({ sessionId: "session-x" });
    expect(first.kind).toBe("adopted");
    if (first.kind !== "adopted") throw new Error("unreachable");
    expect(first.existing).toBe(false);
    expect(first.task).toMatchObject({ sessionId: "session-x", title: "title of session-x", cwd: "/cold", origin: "adopted", status: "idle", lastReportedSeq: 1 });
    const again = await service.adopt({ sessionId: "session-x", title: "ignored" });
    expect(again).toMatchObject({ kind: "adopted", existing: true, task: { id: first.task.id } });
    expect(await service.listTasks()).toHaveLength(1);
  });

  it("adopts by title query when exactly one session matches, otherwise returns candidates", async () => {
    const { service, ctx, persist } = harness();
    persist("session-1");
    persist("session-2");
    ctx.sessionQuery.searchSessions.mockResolvedValueOnce({ items: [{ header: { id: "session-1", cwd: "/one" } }] });
    const one = await service.adopt({ titleQuery: "周报" });
    // cwd comes from the persisted header (inspect), not from the search hit.
    expect(one).toMatchObject({ kind: "adopted", task: { sessionId: "session-1", cwd: "/cold" } });
    ctx.sessionQuery.searchSessions.mockResolvedValueOnce({ items: [{ header: { id: "session-1" } }, { header: { id: "session-2" } }] });
    const many = await service.adopt({ titleQuery: "x" });
    expect(many).toEqual({ kind: "candidates", candidates: [{ sessionId: "session-1", title: "title of session-1" }, { sessionId: "session-2", title: "title of session-2" }] });
    await expect(service.adopt({})).rejects.toThrow(/sessionId or titleQuery/u);
  });

  it("reads the last N completed turns and closes a task", async () => {
    const { service, persist } = harness();
    persist("session-r", [
      { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } },
      { type: "user/message", seq: 1, time: 1, data: { id: "u1", role: "user", content: [{ type: "text", text: "q1" }] } },
      { type: "assistant/message", seq: 2, time: 1, data: { turn: 0, step: 0, message: { id: "a1", role: "assistant", content: [{ type: "text", text: "r1" }] } } },
      { type: "turn/end", seq: 3, time: 9, data: { turn: 0, reason: { kind: "completed" } } },
      { type: "turn/start", seq: 4, time: 1, data: { turn: 1 } },
      { type: "user/message", seq: 5, time: 1, data: { id: "u2", role: "user", content: [{ type: "text", text: "q2" }] } },
      { type: "turn/end", seq: 6, time: 10, data: { turn: 1, reason: { kind: "aborted" } } },
    ]);
    const adopted = await service.adopt({ sessionId: "session-r" });
    if (adopted.kind !== "adopted") throw new Error("unreachable");
    const turns = await service.readTask(adopted.task.id, 1);
    expect(turns).toEqual([{ turn: 1, user: "q2", assistant: "", endedAt: 10, failed: true }]);
    expect(await service.readTask(adopted.task.id)).toHaveLength(2);
    const closed = await service.closeTask(adopted.task.id);
    expect(closed.status).toBe("done");
    expect(await service.listTasks()).toEqual([]);
    expect(await service.listTasks(true)).toHaveLength(1);
    await expect(service.closeTask("nope")).rejects.toThrow(/unknown task/u);
  });
});
