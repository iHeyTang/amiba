import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import {
  addHermesKanbanComment,
  createHermesKanbanTask,
  getHermesKanbanTask,
  getHermesKanbanTasks,
  runHermesKanbanTaskAction,
  updateHermesKanbanTask,
} from "../hermes-kanban";

describe("Hermes Kanban client", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
  });

  it("uses Hermes' current board when the caller does not choose one", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({ ok: true, board: "current", tasks: [], counts: {} }),
    );

    await getHermesKanbanTasks({ sessionId: "session-1" });

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/kanban/tasks?session_id=session-1",
    );
  });

  it("creates tasks on an explicitly selected board", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({ ok: true, task: { id: "task-1" } }),
    );

    await createHermesKanbanTask({ title: "Research" }, "product");

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/kanban/tasks?board=product",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Research" }),
      }),
    );
  });

  it("loads the task inspector from the task resource", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        board: "product",
        task: { id: "task-1" },
        comments: [],
        attachments: [],
        runs: [],
        events: [],
      }),
    );

    const result = await getHermesKanbanTask("task-1", "product");

    expect(result.ok).toBe(true);
    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/kanban/tasks/task-1?board=product",
    );
  });

  it("patches editable fields and supports unassigning a task", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        board: "product",
        task: { id: "task-1" },
        comments: [],
        attachments: [],
        runs: [],
        events: [],
      }),
    );

    await updateHermesKanbanTask(
      "task-1",
      { title: "Updated", assignee: null },
      "product",
    );

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/kanban/tasks/task-1?board=product",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Updated", assignee: null }),
      }),
    );
  });

  it("posts lifecycle actions to the child action route", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        board: "product",
        task: { id: "task-1" },
        comments: [],
        attachments: [],
        runs: [],
        events: [],
      }),
    );

    await runHermesKanbanTaskAction(
      "task-1",
      { action: "block", reason: "Needs input" },
      "product",
    );

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/kanban/tasks/task-1/actions?board=product",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "block", reason: "Needs input" }),
      }),
    );
  });

  it("posts comments to the task conversation", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        board: "product",
        task: { id: "task-1" },
        comments: [],
        attachments: [],
        runs: [],
        events: [],
      }),
    );

    await addHermesKanbanComment("task-1", "Please verify", "product");

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/kanban/tasks/task-1/comments?board=product",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "Please verify", author: "amiba" }),
      }),
    );
  });
});
