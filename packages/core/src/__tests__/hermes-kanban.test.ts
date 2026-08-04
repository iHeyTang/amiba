import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import { createHermesKanbanTask, getHermesKanbanTasks } from "../hermes-kanban";

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
});
