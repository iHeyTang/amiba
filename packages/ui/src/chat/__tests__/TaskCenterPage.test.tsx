import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kanbanCore = vi.hoisted(() => ({
  addHermesKanbanComment: vi.fn(),
  addHermesKanbanDependency: vi.fn(),
  createHermesKanbanTask: vi.fn(),
  deleteHermesKanbanAttachment: vi.fn(),
  deleteHermesKanbanTask: vi.fn(),
  downloadHermesKanbanAttachment: vi.fn(),
  getHermesKanbanBoards: vi.fn(),
  getHermesKanbanTask: vi.fn(),
  getHermesKanbanTasks: vi.fn(),
  getHermesProfiles: vi.fn(),
  removeHermesKanbanDependency: vi.fn(),
  runHermesKanbanTaskAction: vi.fn(),
  updateHermesKanbanTask: vi.fn(),
  uploadHermesKanbanAttachment: vi.fn(),
}));

vi.mock("@amiba/core", () => kanbanCore);

import { TaskCenterPage } from "../TaskCenterPage";

const readyTask = {
  id: "task-1",
  title: "Implement audit trail",
  body: "Record every lifecycle transition",
  assignee: "builder",
  status: "ready" as const,
  priority: 2,
  created_by: "amiba",
  created_at: 1,
  started_at: null,
  completed_at: null,
  workspace_kind: "dir" as const,
  workspace_path: "/tmp/project",
  branch_name: null,
  project_id: null,
  result: null,
  skills: [],
  model_override: null,
  provider_override: null,
  session_id: null,
  block_kind: null,
  latest_summary: null,
  parents: [],
  children: [],
};

const detail = {
  ok: true,
  board: "default",
  task: readyTask,
  comments: [],
  attachments: [],
  runs: [],
  events: [],
};

describe("TaskCenterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kanbanCore.getHermesKanbanBoards.mockResolvedValue({
      ok: true,
      current: "default",
      boards: [
        {
          slug: "default",
          name: "Default",
          description: "",
          icon: "",
          color: "",
          default_workdir: null,
          created_at: null,
          archived: false,
          counts: { ready: 1 },
          total: 1,
          is_current: true,
        },
      ],
    });
    kanbanCore.getHermesKanbanTasks.mockResolvedValue({
      ok: true,
      board: "default",
      tasks: [readyTask],
      counts: { ready: 1 },
    });
    kanbanCore.getHermesKanbanTask.mockResolvedValue(detail);
    kanbanCore.getHermesProfiles.mockResolvedValue({
      ok: true,
      active: "builder",
      profiles: [
        { name: "builder", description: "Build agent" },
        { name: "researcher", description: "Research agent" },
        { name: "reviewer", description: "Review agent" },
        { name: "writer", description: "Writing agent" },
      ],
    });
    kanbanCore.addHermesKanbanComment.mockResolvedValue(detail);
    kanbanCore.runHermesKanbanTaskAction.mockResolvedValue(detail);
    kanbanCore.updateHermesKanbanTask.mockResolvedValue(detail);
    kanbanCore.createHermesKanbanTask.mockResolvedValue({
      ok: true,
      task: readyTask,
    });
  });

  it("owns one integrated top header for its title and board actions", async () => {
    render(<TaskCenterPage />);

    await screen.findByRole("button", { name: /Implement audit trail/ });
    const header = screen.getByTestId("task-board-header");
    expect(
      within(header).getByRole("heading", { name: "Task board" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByPlaceholderText("Search tasks…"),
    ).toBeInTheDocument();
    expect(
      within(header).getByText(
        "Background execution, handoffs, and tasks that need your attention",
      ),
    ).toBeInTheDocument();
    expect(
      within(header).queryByRole("button", { name: "New task" }),
    ).not.toBeInTheDocument();
    expect(
      within(header).queryByText("Live · refreshes every 5 seconds"),
    ).not.toBeInTheDocument();

    expect(screen.getByTestId("task-board-lanes")).toHaveClass(
      "grid",
      "w-full",
      "grid-cols-[repeat(5,minmax(16rem,1fr))]",
    );
  });

  it("has no competing top-level creation entry but keeps subtask intervention", async () => {
    render(<TaskCenterPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Implement audit trail/ }),
    );
    expect(
      screen.queryByRole("button", { name: "New task" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add subtask" }));
    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByRole("heading", { name: "Add subtask" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("combobox", { name: "Responsible agent" }),
    ).toHaveTextContent("builder");

    await userEvent.type(
      within(dialog).getByLabelText("Title"),
      "Verify event ordering",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add" }),
    );

    expect(kanbanCore.createHermesKanbanTask).toHaveBeenCalledWith(
      {
        title: "Verify event ordering",
        body: undefined,
        assignee: "builder",
        workspace_path: undefined,
        priority: 0,
        parents: ["task-1"],
      },
      "default",
    );
  });

  it("shows progress for any task graph created by the responsible agent", async () => {
    const rootTask = { ...readyTask, children: ["child-1"] };
    const childTask = {
      ...readyTask,
      id: "child-1",
      title: "Research branch",
      assignee: "researcher",
      status: "done" as const,
      parents: ["task-1"],
    };
    kanbanCore.getHermesKanbanTasks.mockResolvedValue({
      ok: true,
      board: "default",
      tasks: [rootTask, childTask],
      counts: { ready: 1, done: 1 },
    });
    kanbanCore.getHermesKanbanTask.mockResolvedValue({
      ...detail,
      task: rootTask,
    });

    render(<TaskCenterPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Implement audit trail/ }),
    );

    expect(
      await screen.findByText(
        "Orchestration progress: 1/1 child tasks complete.",
      ),
    ).toBeInTheDocument();
  });

  it("opens a task inspector with ownership and execution context", async () => {
    render(<TaskCenterPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Implement audit trail/ }),
    );

    expect(kanbanCore.getHermesKanbanTask).toHaveBeenCalledWith(
      "task-1",
      "default",
    );
    expect(
      await screen.findByText("Next handler: agent builder"),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(
      screen.getByText("Record every lifecycle transition"),
    ).toBeInTheDocument();
  });

  it("adds operator guidance as a task comment", async () => {
    render(<TaskCenterPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Implement audit trail/ }),
    );

    await userEvent.type(
      await screen.findByPlaceholderText("Add guidance or context…"),
      "Please verify the migration",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send comment" }));

    expect(kanbanCore.addHermesKanbanComment).toHaveBeenCalledWith(
      "task-1",
      "Please verify the migration",
      "default",
    );
  });

  it("sends a ready task to review with an explicit handoff", async () => {
    render(<TaskCenterPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Implement audit trail/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Request review" }),
    );
    await userEvent.type(
      screen.getByPlaceholderText("Tell the reviewer what to verify…"),
      "Check event ordering",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Request review" }),
    );

    expect(kanbanCore.runHermesKanbanTaskAction).toHaveBeenCalledWith(
      "task-1",
      {
        action: "request_review",
        reviewer: "builder",
        summary: "Check event ordering",
      },
      "default",
    );
  });

  it("edits task content without redundantly reassigning the current agent", async () => {
    render(<TaskCenterPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: /Implement audit trail/ }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const title = screen.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Implement complete audit trail");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(kanbanCore.updateHermesKanbanTask).toHaveBeenCalledWith(
      "task-1",
      {
        title: "Implement complete audit trail",
        body: "Record every lifecycle transition",
        priority: 2,
        workspace_path: "/tmp/project",
      },
      "default",
    );
  });
});
