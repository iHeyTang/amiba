import { describe, expect, it, vi } from "vitest";

import { DISPATCH_FOOTER, STEWARD_TITLE } from "./service.js";
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
    await first.service.dispose();

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

  it("registers steward tools onto an already-live steward agent", async () => {
    const { service, store, live, created, resumed, onStewardSetup, makeAgent } = harness();
    const id = "session-live";
    await store.mutate((s) => ({ ...s, stewardSessionId: id }));
    live.set(id, makeAgent(id));
    expect(await service.ensureStewardSessionId()).toBe(id);
    expect(onStewardSetup).toHaveBeenCalledWith(live.get(id)!.ctx);
    expect(created).toHaveLength(0);
    expect(resumed).toHaveLength(0);
  });

  it("propagates a resume failure instead of recreating the steward session", async () => {
    const { service, store, ctx, created, persist } = harness();
    const id = "session-x";
    await store.mutate((s) => ({ ...s, stewardSessionId: id }));
    persist(id, [], { agentPreset: "amiba-steward" });
    ctx.agents.resume.mockRejectedValueOnce(new Error("setup exploded"));
    await expect(service.ensureStewardSessionId()).rejects.toThrow(/setup exploded/u);
    expect(created).toHaveLength(0);
    expect((await store.read()).stewardSessionId).toBe(id);
  });
});

describe("StewardService — title pin", () => {
  it("pins the title when it creates the steward session", async () => {
    const { service, ctx, live } = harness();
    const id = await service.ensureStewardSessionId();
    expect(ctx.sessionTitle.rename).toHaveBeenCalledWith(live.get(id)!.session, STEWARD_TITLE);
  });

  it("pins the title when it resumes a persisted steward session", async () => {
    const { service, ctx, store, persist, live } = harness();
    const id = "session-resumed";
    await store.mutate((s) => ({ ...s, stewardSessionId: id }));
    persist(id, [], { agentPreset: "amiba-steward" });
    await service.start();
    expect(ctx.sessionTitle.rename).toHaveBeenCalledWith(live.get(id)!.session, STEWARD_TITLE);
  });

  it("pins the title when it reuses an already-live steward agent", async () => {
    const { service, ctx, store, live, makeAgent } = harness();
    const id = "session-live";
    await store.mutate((s) => ({ ...s, stewardSessionId: id }));
    live.set(id, makeAgent(id));
    await service.ensureStewardSessionId();
    expect(ctx.sessionTitle.rename).toHaveBeenCalledWith(live.get(id)!.session, STEWARD_TITLE);
  });

  it("does not rename when the log already carries the fixed title", async () => {
    const { service, ctx, store, persist } = harness();
    const id = "session-titled";
    await store.mutate((s) => ({ ...s, stewardSessionId: id }));
    persist(id, [{ type: "session/title", seq: 0, time: 1, data: { title: STEWARD_TITLE, messageSeqs: [], source: { kind: "user" } } }], {
      agentPreset: "amiba-steward",
    });
    await service.start();
    expect(ctx.sessionTitle.rename).not.toHaveBeenCalled();
  });

  it("swallows a rename failure instead of breaking boot", async () => {
    const { service, ctx } = harness();
    ctx.sessionTitle.rename.mockImplementationOnce(() => {
      throw new Error("rename exploded");
    });
    await expect(service.ensureStewardSessionId()).resolves.toMatch(/^session-/u);
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
    // A brief IS addressed to the task session — it stays a `relay`, and so
    // stays a user turn in that session's transcript.
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

  it("resumes a cold task session once when two dispatches race", async () => {
    const { service, live, resumed } = harness();
    const first = await service.dispatch({ newTask: { title: "A" }, message: "start" });
    live.delete(first.sessionId); // simulate the agent retiring before either dispatch runs
    await Promise.all([
      service.dispatch({ taskId: first.taskId, message: "a" }),
      service.dispatch({ taskId: first.taskId, message: "b" }),
    ]);
    expect(resumed).toEqual([first.sessionId]);
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

describe("StewardService — new task session title", () => {
  it("names a new task session after its task, before the followup", async () => {
    const { service, ctx, live } = harness();
    const result = await service.dispatch({ newTask: { title: "写周报" }, message: "go" });
    const session = live.get(result.sessionId)!.session;
    expect(ctx.sessionTitle.rename).toHaveBeenCalledWith(session, "写周报");
    const renameOrder = ctx.sessionTitle.rename.mock.invocationCallOrder[0]!;
    const followupOrder = live.get(result.sessionId)!.followup.mock.invocationCallOrder[0]!;
    expect(renameOrder).toBeLessThan(followupOrder);
  });

  it("does not rename when dispatching to an existing task", async () => {
    const { service, ctx } = harness();
    const first = await service.dispatch({ newTask: { title: "A" }, message: "start" });
    ctx.sessionTitle.rename.mockClear();
    await service.dispatch({ taskId: first.taskId, message: "again" });
    expect(ctx.sessionTitle.rename).not.toHaveBeenCalled();
  });

  it("does not rename an adopted session", async () => {
    const { service, ctx, persist } = harness();
    persist("session-x", [
      { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } },
      { type: "turn/end", seq: 1, time: 2, data: { turn: 0, reason: { kind: "completed" } } },
    ]);
    await service.adopt({ sessionId: "session-x" });
    expect(ctx.sessionTitle.rename).not.toHaveBeenCalled();
  });

  it("swallows a rename failure and still dispatches", async () => {
    const { service, ctx, live } = harness();
    ctx.sessionTitle.rename.mockImplementationOnce(() => {
      throw new Error("rename exploded");
    });
    const result = await service.dispatch({ newTask: { title: "B" }, message: "go" });
    expect(result.created).toBe(true);
    expect(live.get(result.sessionId)!.followup).toHaveBeenCalledTimes(1);
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

  it("seeds the report cursor at the last completed turn so an open turn is still reported later", async () => {
    const { service, persist } = harness();
    persist("session-o", [
      { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } },
      { type: "user/message", seq: 1, time: 1, data: { id: "u1", role: "user", content: [{ type: "text", text: "q1" }] } },
      { type: "assistant/message", seq: 2, time: 1, data: { turn: 0, step: 0, message: { id: "a1", role: "assistant", content: [{ type: "text", text: "r1" }] } } },
      { type: "turn/end", seq: 3, time: 9, data: { turn: 0, reason: { kind: "completed" } } },
      { type: "turn/start", seq: 4, time: 1, data: { turn: 1 } },
      { type: "user/message", seq: 5, time: 1, data: { id: "u2", role: "user", content: [{ type: "text", text: "q2" }] } },
    ]);
    const adopted = await service.adopt({ sessionId: "session-o" });
    if (adopted.kind !== "adopted") throw new Error("unreachable");
    expect(adopted.task.lastReportedSeq).toBe(3);
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

  it("refuses to adopt the steward's own session", async () => {
    const { service } = harness();
    const id = await service.ensureStewardSessionId();
    await expect(service.adopt({ sessionId: id })).rejects.toThrow(/cannot be adopted/u);
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

describe("StewardService — reporting", () => {
  const turnEvents = (turn: number, reply: string, reason: Record<string, unknown> = { kind: "completed" }) => [
    { type: "turn/start", seq: turn * 4, time: 1, data: { turn } },
    { type: "user/message", seq: turn * 4 + 1, time: 1, data: { id: `u${turn}`, role: "user", content: [{ type: "text", text: `ask ${turn}` }] } },
    { type: "assistant/message", seq: turn * 4 + 2, time: 1, data: { turn, step: 0, message: { id: `a${turn}`, role: "assistant", content: [{ type: "text", text: reply }] } } },
    { type: "turn/end", seq: turn * 4 + 3, time: 100 + turn, data: { turn, reason } },
  ];

  it("relays a finished turn into the steward session and updates the task", async () => {
    const { service, live, emit } = harness();
    const stewardId = await service.ensureStewardSessionId();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "写周报" }, message: "go" });
    for (const event of turnEvents(0, "周报写好了，在 report.md")) emit(sessionId, event);
    await vi.waitFor(() => expect(live.get(stewardId)!.followup).toHaveBeenCalledTimes(1));
    const message = live.get(stewardId)!.followup.mock.calls[0]![0] as { content: Array<{ text: string }>; source: Record<string, unknown> };
    expect(message.content[0]!.text).toContain("【任务汇报】写周报");
    expect(message.content[0]!.text).toContain("结果：完成");
    expect(message.content[0]!.text).toContain("周报写好了，在 report.md");
    // A report is an ACCOUNT of a finished turn, not a message anyone
    // addressed to the steward — `notice`, so the transcript collapses it
    // into a context row keyed by this summary instead of showing it as
    // something the person said.
    expect(message.source).toEqual({
      kind: "plugin",
      plugin: "amiba-steward",
      form: "notice",
      summary: "任务汇报：写周报 — 完成",
    });
    const task = (await service.listTasks())[0]!;
    expect(task).toMatchObject({ id: taskId, status: "idle", lastReportedSeq: 3, lastSummary: "周报写好了，在 report.md" });
  });

  it("reports a failed turn with its reason and marks the task failed", async () => {
    const { service, live, emit } = harness();
    const stewardId = await service.ensureStewardSessionId();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "B" }, message: "go" });
    for (const event of turnEvents(0, "", { kind: "error", error: { message: "rate limited" } })) emit(sessionId, event);
    await vi.waitFor(() => expect(live.get(stewardId)!.followup).toHaveBeenCalledTimes(1));
    const message = live.get(stewardId)!.followup.mock.calls[0]![0] as { content: Array<{ text: string }>; source: Record<string, unknown> };
    const text = message.content[0]!.text;
    expect(text).toContain("结果：失败（error: rate limited）");
    // The row's one line reuses the body's outcome vocabulary verbatim.
    expect(message.source).toMatchObject({ form: "notice", summary: "任务汇报：B — 失败（error: rate limited）" });
    const task = (await service.listTasks())[0]!;
    expect(task).toMatchObject({ id: taskId, status: "failed", lastError: "error: rate limited" });
  });

  it("bounds a long title's summary to the kernel's collapsed-row limit", async () => {
    // A task title is caller text with no length of its own; the summary
    // rides a durable log record DSH caps at 120 characters.
    const { service, live, emit } = harness();
    const stewardId = await service.ensureStewardSessionId();
    const { sessionId } = await service.dispatch({ newTask: { title: "汇".repeat(300) }, message: "go" });
    for (const event of turnEvents(0, "done")) emit(sessionId, event);
    await vi.waitFor(() => expect(live.get(stewardId)!.followup).toHaveBeenCalledTimes(1));
    const source = (live.get(stewardId)!.followup.mock.calls[0]![0] as { source: { summary: string } }).source;
    expect(source.summary.length).toBeLessThanOrEqual(120);
    expect(source.summary.startsWith("任务汇报：汇汇")).toBe(true);
  });

  it("ignores events from the steward's own session and from unmanaged sessions", async () => {
    const { service, live, emit, created, ctx } = harness();
    const stewardId = await service.ensureStewardSessionId();
    for (const event of turnEvents(0, "self")) emit(stewardId, event);
    await service.dispatch({ newTask: { title: "C" }, message: "go" });
    await ctx.agents.create({ sessionId: "session-stray" });
    for (const event of turnEvents(0, "stray")) emit("session-stray", event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(live.get(stewardId)!.followup).not.toHaveBeenCalled();
    expect(created).toHaveLength(3);
  });

  it("flags needs_input at once but only relays the question after the notice delay", async () => {
    const { service, live, emit } = harness({ askNoticeDelayMs: 10 });
    const stewardId = await service.ensureStewardSessionId();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "D" }, message: "go" });
    emit(sessionId, { type: "tool/call", seq: 0, time: 1, data: { turn: 0, step: 0, callId: "c1", name: "ask_user_question", arguments: "{}" } });
    await vi.waitFor(async () => expect((await service.listTasks())[0]!.status).toBe("needs_input"));
    await vi.waitFor(() => expect(live.get(stewardId)!.followup).toHaveBeenCalledTimes(1));
    const message = live.get(stewardId)!.followup.mock.calls[0]![0] as { content: Array<{ text: string }>; source: Record<string, unknown> };
    const text = message.content[0]!.text;
    expect(text).toContain("【任务汇报】D");
    expect(text).toContain("正在它的会话里等你回答");
    // Also an account, with its own outcome word in the collapsed row.
    expect(message.source).toMatchObject({ form: "notice", summary: "任务汇报：D — 需要你输入" });
    emit(sessionId, { type: "tool/result", seq: 1, time: 2, data: { turn: 0, step: 0, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [] }] } } });
    await vi.waitFor(async () => expect((await service.listTasks())[0]!.status).toBe("running"));
    expect((await service.listTasks())[0]!.id).toBe(taskId);
  });

  it("does not relay a question the guard denied", async () => {
    const { service, live, emit } = harness({ askNoticeDelayMs: 10 });
    const stewardId = await service.ensureStewardSessionId();
    const { sessionId } = await service.dispatch({ newTask: { title: "G" }, message: "go" });
    // The guard denies at EXECUTION time, so the request is already logged as a
    // tool/call and the denial follows immediately as its tool/result.
    emit(sessionId, { type: "tool/call", seq: 0, time: 1, data: { turn: 0, step: 0, callId: "c1", name: "ask_user_question", arguments: "{}" } });
    emit(sessionId, { type: "tool/result", seq: 1, time: 1, data: { turn: 0, step: 0, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [] }] } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(live.get(stewardId)!.followup).not.toHaveBeenCalled();
    expect((await service.listTasks())[0]!.status).toBe("running");
  });

  it("keeps event order when a call and its result arrive back-to-back", async () => {
    const { service, live, emit } = harness({ askNoticeDelayMs: 10 });
    const stewardId = await service.ensureStewardSessionId();
    const { sessionId } = await service.dispatch({ newTask: { title: "G2" }, message: "go" });
    // 20 denied asks in a row, each call immediately followed by its result,
    // all emitted synchronously — the un-serialized taskBySession lookup used
    // to let a later tool/result's queue entry race ahead of an earlier
    // tool/call's, leaving the task stuck at needs_input.
    for (let i = 0; i < 20; i++) {
      const callId = `c${i}`;
      emit(sessionId, { type: "tool/call", seq: i * 2, time: 1, data: { turn: 0, step: i, callId, name: "ask_user_question", arguments: "{}" } });
      emit(sessionId, { type: "tool/result", seq: i * 2 + 1, time: 1, data: { turn: 0, step: i, message: { content: [{ type: "tool-result", toolCallId: callId, content: [] }] } } });
    }
    await vi.waitFor(async () => expect((await service.listTasks())[0]!.status).toBe("running"), { timeout: 3000, interval: 20 });
    expect(live.get(stewardId)!.followup).not.toHaveBeenCalled();
  });

  it("heals a stale needs_input when the answer never reached the handler", async () => {
    const { service, live, emit } = harness({ askNoticeDelayMs: 10 });
    const stewardId = await service.ensureStewardSessionId();
    const { sessionId } = await service.dispatch({ newTask: { title: "G3" }, message: "go" });
    emit(sessionId, { type: "tool/call", seq: 0, time: 1, data: { turn: 0, step: 0, callId: "c1", name: "ask_user_question", arguments: "{}" } });
    // Push the result straight onto the live log synchronously, in the same
    // tick as the emit above — this guarantees it lands well before the real
    // 10ms notice timer fires, regardless of how long the queued tool/call
    // handler (which flips status to needs_input) itself takes to run.
    // Simulate the result landing in the live log without the handler ever
    // seeing the event (e.g. missed emit) — the deferred notice must still
    // self-heal by re-checking the live log directly.
    live.get(sessionId)!.session.events.push({
      type: "tool/result",
      seq: 1,
      time: 1,
      data: { turn: 0, step: 0, message: { content: [{ type: "tool-result", toolCallId: "c1", content: [] }] } },
    });
    await vi.waitFor(async () => expect((await service.listTasks())[0]!.status).toBe("running"), { timeout: 3000, interval: 20 });
    expect(live.get(stewardId)!.followup).not.toHaveBeenCalled();
  });

  it("does not report or revive a task closed while its session was mid-turn", async () => {
    const { service, live, emit } = harness();
    const stewardId = await service.ensureStewardSessionId();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "F" }, message: "go" });
    await service.closeTask(taskId);
    for (const event of turnEvents(0, "late reply")) emit(sessionId, event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(live.get(stewardId)!.followup).not.toHaveBeenCalled();
    expect((await service.listTasks(true))[0]!.status).toBe("done");
  });

  it("creates no agent for a deliver queued across dispose()", async () => {
    const { service, emit, created, resumed } = harness();
    const { sessionId } = await service.dispatch({ newTask: { title: "H" }, message: "go" });
    expect(created).toHaveLength(1); // the task session only; no steward yet
    await service.dispose();
    for (const event of turnEvents(0, "late")) emit(sessionId, event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(1);
    expect(resumed).toHaveLength(0);
  });

  it("re-reports turns that completed while the runtime was down", async () => {
    const first = harness();
    const stewardId = await first.service.ensureStewardSessionId();
    const { taskId, sessionId } = await first.service.dispatch({ newTask: { title: "E" }, message: "go" });
    await first.service.dispose();

    const second = harness();
    await second.store.mutate(() => ({
      version: 1,
      stewardSessionId: stewardId,
      tasks: [{ id: taskId, title: "E", sessionId, cwd: "/default", origin: "created", status: "running", lastReportedSeq: -1, createdAt: 1, updatedAt: 1 }],
    }));
    second.persist(stewardId, [], { agentPreset: "amiba-steward" });
    second.persist(sessionId, [...turnEvents(0, "done while down"), ...turnEvents(1, "and again")]);
    await second.service.start();
    await vi.waitFor(() => expect(second.live.get(stewardId)!.followup).toHaveBeenCalledTimes(2));
    const task = (await second.service.listTasks())[0]!;
    expect(task).toMatchObject({ id: taskId, status: "idle", lastReportedSeq: 7, lastSummary: "and again" });
    expect(second.resumed).toEqual([stewardId]);
  });
});

describe("StewardService — model route", () => {
  // Agent presets render `{{model}}` from the agent's own route. A session
  // created or resumed without `agentOptions` has no route, so prompt
  // assembly fails ("{{model}} has no value") on the first turn. Mirror
  // messaging-core: seed the deployment's default selection when the
  // optional `agentDefaultModel` service is mounted.
  const selection = { provider: "deepseek", model: "deepseek-chat" };

  it("seeds the default model route on every task and steward create/resume", async () => {
    const { service, created, resumeOptions, reflectServices, live } = harness();
    reflectServices.set("agentDefaultModel", { currentSelection: () => selection });
    const stewardId = await service.ensureStewardSessionId();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "金价" }, message: "查金价" });
    expect(created.find((c) => c.sessionId === stewardId)?.agentOptions).toEqual(selection);
    expect(created.find((c) => c.sessionId === sessionId)?.agentOptions).toEqual(selection);
    live.delete(sessionId);
    await service.dispatch({ taskId, message: "再查" });
    expect(resumeOptions).toEqual([selection]);
  });

  it("omits agentOptions when no default model service is mounted", async () => {
    const { service, created } = harness();
    await service.dispatch({ newTask: { title: "A" }, message: "go" });
    expect(created.every((c) => c.agentOptions === undefined)).toBe(true);
  });
});

describe("StewardService — archived sessions", () => {
  // DSH's `ctx.workspaceRegistry.archivedSessionIds` is a registry-global
  // archive set (Amiba's session "delete" becoming a DSH archive); a task
  // whose session lands in it is over and must never be resumed or reported
  // on again. The optional service is read via `ctx.reflect.get`, so tests
  // arm it the same way the "model route" describe above arms
  // `agentDefaultModel`: `reflectServices.set("workspaceRegistry", { archivedSessionIds: [...] })`.
  const turnEvents = (turn: number, reply: string) => [
    { type: "turn/start", seq: turn * 4, time: 1, data: { turn } },
    { type: "user/message", seq: turn * 4 + 1, time: 1, data: { id: `u${turn}`, role: "user", content: [{ type: "text", text: `ask ${turn}` }] } },
    { type: "assistant/message", seq: turn * 4 + 2, time: 1, data: { turn, step: 0, message: { id: `a${turn}`, role: "assistant", content: [{ type: "text", text: reply }] } } },
    { type: "turn/end", seq: turn * 4 + 3, time: 100 + turn, data: { turn, reason: { kind: "completed" } } },
  ];

  it("refuses to dispatch to an archived task's session and closes it instead", async () => {
    const { service, reflectServices, live } = harness();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "A" }, message: "go" });
    reflectServices.set("workspaceRegistry", { archivedSessionIds: [sessionId] });
    await expect(service.dispatch({ taskId, message: "again" })).rejects.toThrow(/archived/u);
    // Never resumed/followed-up: the guard runs before `ensureTaskAgent`.
    expect(live.get(sessionId)!.followup).toHaveBeenCalledTimes(1);
    const stored = (await service.snapshot()).tasks.find((t) => t.id === taskId)!;
    expect(stored.status).toBe("done");
  });

  it("excludes an archived task from listTasks regardless of includeDone, unlike an ordinary closed task", async () => {
    const { service, reflectServices } = harness();
    const { taskId: archivedId, sessionId: archivedSession } = await service.dispatch({ newTask: { title: "B" }, message: "go" });
    const { taskId: closedId } = await service.dispatch({ newTask: { title: "B2" }, message: "go" });
    await service.closeTask(closedId);
    // Sanity: before archival the task is live (dispatch leaves it "running").
    expect((await service.listTasks()).map((t) => t.id)).toEqual([archivedId]);
    reflectServices.set("workspaceRegistry", { archivedSessionIds: [archivedSession] });
    expect(await service.listTasks()).toEqual([]);
    // An ordinary closed task still surfaces with includeDone; the archived
    // one never does — that's what actually drops it from the client's
    // 「大管家」 group poll (`listTasks(true)`), unlike a task the user just
    // finished with `steward_close_task`.
    const withDone = await service.listTasks(true);
    expect(withDone.map((t) => t.id)).toEqual([closedId]);
    const stored = (await service.snapshot()).tasks.find((t) => t.id === archivedId)!;
    expect(stored.status).toBe("done");
  });

  it("leaves a non-archived task's dispatch and listing unaffected", async () => {
    const { service, reflectServices, live } = harness();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "C" }, message: "go" });
    reflectServices.set("workspaceRegistry", { archivedSessionIds: ["session-someone-else"] });
    await service.dispatch({ taskId, message: "again" });
    expect(live.get(sessionId)!.followup).toHaveBeenCalledTimes(2);
    expect((await service.listTasks()).map((t) => t.id)).toEqual([taskId]);
  });

  it("behaves as before when the workspace registry service is absent", async () => {
    const { service, live } = harness();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "D" }, message: "go" });
    await service.dispatch({ taskId, message: "again" });
    expect(live.get(sessionId)!.followup).toHaveBeenCalledTimes(2);
    expect((await service.listTasks()).map((t) => t.id)).toEqual([taskId]);
  });

  it("refuses to adopt an already-archived session", async () => {
    const { service, persist, reflectServices } = harness();
    persist("session-x", [
      { type: "turn/start", seq: 0, time: 1, data: { turn: 0 } },
      { type: "turn/end", seq: 1, time: 2, data: { turn: 0, reason: { kind: "completed" } } },
    ]);
    reflectServices.set("workspaceRegistry", { archivedSessionIds: ["session-x"] });
    await expect(service.adopt({ sessionId: "session-x" })).rejects.toThrow(/archived/u);
    // No task row should have been created for it — a refused adopt is not
    // the same as an adopt-then-immediately-close.
    expect(await service.listTasks(true)).toEqual([]);
  });

  it("tells the caller an archived task is closed instead of returning stale turns", async () => {
    const { service, reflectServices } = harness();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "E" }, message: "go" });
    reflectServices.set("workspaceRegistry", { archivedSessionIds: [sessionId] });
    await expect(service.readTask(taskId)).rejects.toThrow(/archived/u);
    const stored = (await service.snapshot()).tasks.find((t) => t.id === taskId)!;
    expect(stored.status).toBe("done");
  });

  it("does not report or revive a completed turn arriving on an already-archived session", async () => {
    const { service, live, emit, reflectServices } = harness();
    const stewardId = await service.ensureStewardSessionId();
    const { taskId, sessionId } = await service.dispatch({ newTask: { title: "F" }, message: "go" });
    reflectServices.set("workspaceRegistry", { archivedSessionIds: [sessionId] });
    for (const event of turnEvents(0, "late reply")) emit(sessionId, event);
    await vi.waitFor(async () => {
      const stored = (await service.snapshot()).tasks.find((t) => t.id === taskId)!;
      expect(stored.status).toBe("done");
    });
    expect(live.get(stewardId)!.followup).not.toHaveBeenCalled();
  });

  it("does not resurrect an archived task's reports on boot recovery", async () => {
    const first = harness();
    const stewardId = await first.service.ensureStewardSessionId();
    const { taskId, sessionId } = await first.service.dispatch({ newTask: { title: "G" }, message: "go" });
    await first.service.dispose();

    const second = harness();
    second.reflectServices.set("workspaceRegistry", { archivedSessionIds: [sessionId] });
    await second.store.mutate(() => ({
      version: 1,
      stewardSessionId: stewardId,
      tasks: [{ id: taskId, title: "G", sessionId, cwd: "/default", origin: "created", status: "running", lastReportedSeq: -1, createdAt: 1, updatedAt: 1 }],
    }));
    second.persist(stewardId, [], { agentPreset: "amiba-steward" });
    second.persist(sessionId, turnEvents(0, "done while down"));
    await second.service.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second.live.get(stewardId)?.followup).not.toHaveBeenCalled();
    const stored = (await second.service.snapshot()).tasks.find((t) => t.id === taskId)!;
    expect(stored.status).toBe("done");
  });
});
