import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoard } from "./TaskBoard.js";
import { createStewardClientState } from "./state.js";

const task = (id: string, status: string) => ({
  id,
  title: `Task ${id}`,
  sessionId: `session-${id}`,
  cwd: "/",
  origin: "created",
  status,
  lastReportedSeq: -1,
  lastSummary: `summary ${id}`,
  createdAt: 1,
  updatedAt: 1,
});

describe("TaskBoard", () => {
  beforeEach(() => {
    document.documentElement.lang = "zh-CN";
  });

  it("renders nothing unless the current session is the steward's", () => {
    const state = createStewardClientState();
    state.setStewardSessionId("session-s");
    const { container } = render(
      <TaskBoard
        sessionId={"session-other" as never}
        state={state}
        listTasks={vi.fn()}
        openSession={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a popover listing active tasks with status chips and jumps to a task session", async () => {
    const state = createStewardClientState();
    state.setStewardSessionId("session-s");
    const listTasks = vi.fn().mockResolvedValue([task("a", "running"), task("b", "needs_input")]);
    const openSession = vi.fn();
    render(
      <TaskBoard
        sessionId={"session-s" as never}
        state={state}
        listTasks={listTasks}
        openSession={openSession}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "任务看板" }));
    expect(await screen.findByText("Task a")).toBeVisible();
    expect(screen.getByText("进行中")).toBeVisible();
    expect(screen.getByText("待你输入")).toBeVisible();
    expect(screen.getByText("summary b")).toBeVisible();
    await userEvent.click(screen.getByText("Task b"));
    expect(openSession).toHaveBeenCalledWith("session-b");
    expect(listTasks).toHaveBeenCalledWith(false);
  });

  it("shows the empty line when there are no tasks", async () => {
    const state = createStewardClientState();
    state.setStewardSessionId("session-s");
    render(
      <TaskBoard
        sessionId={"session-s" as never}
        state={state}
        listTasks={vi.fn().mockResolvedValue([])}
        openSession={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "任务看板" }));
    expect(await screen.findByText("还没有任务。直接告诉大管家你要做什么。")).toBeVisible();
  });
});
