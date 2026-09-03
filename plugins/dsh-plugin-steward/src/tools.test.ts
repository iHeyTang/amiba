import { describe, expect, it, vi } from "vitest";

import { registerStewardTools, stewardToolDefinitions } from "./tools.js";

function fakeService() {
  return {
    listTasks: vi.fn(async (includeDone?: boolean) => [{ id: "task-1", title: "A", status: includeDone ? "done" : "idle" }]),
    dispatch: vi.fn(async () => ({ taskId: "task-1", sessionId: "session-1", created: false })),
    adopt: vi.fn(async () => ({ kind: "adopted", existing: false, task: { id: "task-2" } })),
    readTask: vi.fn(async () => [{ turn: 0, user: "q", assistant: "a", endedAt: 1, failed: false }]),
    closeTask: vi.fn(async () => ({ id: "task-1", status: "done" })),
  };
}

const text = (result: unknown) => JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);
const exec = {} as never;

describe("steward tools", () => {
  it("declares the five dispatch tools with object schemas", () => {
    const names = stewardToolDefinitions(fakeService() as never).map((d) => d.name);
    expect(names).toEqual(["steward_list_tasks", "steward_dispatch", "steward_adopt", "steward_read_task", "steward_close_task"]);
  });

  it("forwards arguments and returns JSON text", async () => {
    const service = fakeService();
    const tools = Object.fromEntries(stewardToolDefinitions(service as never).map((d) => [d.name, d]));
    expect(text(await tools.steward_list_tasks!.execute({ include_done: true }, exec))).toEqual([{ id: "task-1", title: "A", status: "done" }]);
    expect(service.listTasks).toHaveBeenCalledWith(true);

    await tools.steward_dispatch!.execute({ task_id: "task-1", message: "hi" }, exec);
    expect(service.dispatch).toHaveBeenCalledWith({ taskId: "task-1", newTask: undefined, message: "hi" });
    await tools.steward_dispatch!.execute({ new_task_title: "B", cwd: "/repo", message: "go" }, exec);
    expect(service.dispatch).toHaveBeenLastCalledWith({ taskId: undefined, newTask: { title: "B", cwd: "/repo" }, message: "go" });

    await tools.steward_adopt!.execute({ title_query: "周报" }, exec);
    expect(service.adopt).toHaveBeenCalledWith({ sessionId: undefined, titleQuery: "周报", title: undefined });

    expect(text(await tools.steward_read_task!.execute({ task_id: "task-1", turns: 2 }, exec))).toHaveLength(1);
    expect(service.readTask).toHaveBeenCalledWith("task-1", 2);

    expect(text(await tools.steward_close_task!.execute({ task_id: "task-1" }, exec))).toMatchObject({ status: "done" });
  });

  it("surfaces service errors as thrown errors (the registry renders them to the model)", async () => {
    const service = fakeService();
    service.dispatch.mockRejectedValueOnce(new Error("steward: unknown task \"x\""));
    const tools = Object.fromEntries(stewardToolDefinitions(service as never).map((d) => [d.name, d]));
    await expect(tools.steward_dispatch!.execute({ task_id: "x", message: "m" }, exec)).rejects.toThrow(/unknown task/u);
  });

  it("coerces malformed arguments to safe defaults instead of throwing", async () => {
    const service = fakeService();
    const tools = Object.fromEntries(stewardToolDefinitions(service as never).map((d) => [d.name, d]));

    await tools.steward_list_tasks!.execute({}, exec);
    expect(service.listTasks).toHaveBeenCalledWith(false);

    await tools.steward_list_tasks!.execute({ include_done: "yes" }, exec);
    expect(service.listTasks).toHaveBeenLastCalledWith(false);

    await tools.steward_read_task!.execute({ task_id: "task-1", turns: "2" }, exec);
    expect(service.readTask).toHaveBeenCalledWith("task-1", undefined);

    await tools.steward_dispatch!.execute({ new_task_title: "   ", task_id: "task-1", message: "m" }, exec);
    expect(service.dispatch).toHaveBeenCalledWith({ taskId: "task-1", newTask: undefined, message: "m" });

    await tools.steward_adopt!.execute({ session_id: "", title_query: " x " }, exec);
    expect(service.adopt).toHaveBeenCalledWith({ sessionId: undefined, titleQuery: " x ", title: undefined });
  });

  it("registers every tool into the given agent scope through effect()", () => {
    const register = vi.fn(() => () => undefined);
    const effect = vi.fn((run: () => unknown) => { run(); return () => undefined; });
    registerStewardTools({ tools: { register }, effect } as never, fakeService() as never);
    expect(register).toHaveBeenCalledTimes(5);
    expect(effect).toHaveBeenCalledTimes(5);
  });
});
