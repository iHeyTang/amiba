import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import {
  WorkspacePane,
  WorkspacePaneProvider,
  WorkspacePaneToggle,
  useWorkspacePane,
} from "../WorkspacePane";
import type { WorkspaceInspectorCapability } from "../internal/capabilities";

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
  });
  return event;
}

function Probe() {
  const pane = useWorkspacePane();
  return (
    <>
      <button type="button" onClick={pane.toggle} aria-pressed={pane.open}>
        toggle workspace
      </button>
      <WorkspacePaneToggle />
      <output aria-label="workspace width">{pane.width}</output>
    </>
  );
}

function RecoveryProbe() {
  const pane = useWorkspacePane();
  return (
    <>
      <button type="button" onClick={() => void pane.beginTurn(2)}>
        begin task
      </button>
      <button
        type="button"
        onClick={() =>
          pane.observeToolEvent({
            tool: "write_file",
            toolCallId: "write-1",
            status: "completed",
            args: { path: "src/App.tsx" },
            result: { files_modified: ["src/App.tsx"] },
          })
        }
      >
        observe write
      </button>
      <output aria-label="recovery points">
        {pane.checkpoints.filter((checkpoint) => checkpoint.hasChanges).length}
      </output>
      <output aria-label="workspace open">{String(pane.open)}</output>
      <output aria-label="workspace tabs">{pane.tabs.length}</output>
    </>
  );
}

function KanbanProbe() {
  const pane = useWorkspacePane();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          pane.observeToolEvent({
            tool: "kanban_create",
            toolCallId: "kanban-1",
            status: "completed",
            result: { ok: true, task_id: "task-1" },
          })
        }
      >
        observe durable task
      </button>
      <output aria-label="workspace open">{String(pane.open)}</output>
      <output aria-label="execution requests">
        {pane.collaborationRequestVersion}
      </output>
    </>
  );
}

function ReviewProbe() {
  const pane = useWorkspacePane();
  return (
    <button
      type="button"
      onClick={() =>
        pane.openReview({
          kind: "diff",
          reviewId: "turn:review-layout",
          scope: "turn",
          entries: [
            {
              toolCallId: "patch-1",
              paths: ["src/App.tsx"],
              diff: [
                "--- a/src/App.tsx",
                "+++ b/src/App.tsx",
                "@@ -500,2 +500,2 @@",
                "-old",
                "+new",
                " same context",
              ].join("\n"),
            },
          ],
        })
      }
    >
      open review
    </button>
  );
}

function FileProbe() {
  const pane = useWorkspacePane();
  return (
    <button type="button" onClick={() => pane.openFile("src/App.tsx")}>
      open file
    </button>
  );
}

describe("WorkspacePane responsive behavior", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("allows the workbench to remain open when the viewport is compact", async () => {
    const capability = {
      files: {},
    } as WorkspaceInspectorCapability;

    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <Probe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    const toggle = screen.getByRole("button", {
      name: "toggle workspace",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    const edgeToggle = screen.getByRole("button", {
      name: "workspacePane.open",
    });

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const openEdgeToggle = screen.getByRole("button", {
      name: "workspacePane.collapse",
    });
    expect(openEdgeToggle).toBe(edgeToggle);
    expect(openEdgeToggle).toHaveAttribute("aria-pressed", "true");
    const pane = screen.getByLabelText("workspacePane.title");
    expect(pane.parentElement).toHaveClass(
      "relative",
      "shrink-0",
      "self-stretch",
      "max-[1100px]:!w-1/2",
    );
    expect(pane).toHaveClass(
      "max-[1100px]:!w-full",
      "max-[1100px]:!max-w-none",
    );

    await userEvent.click(openEdgeToggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("creates one task-linked recovery point and marks it after a write", async () => {
    const checkpoint = {
      id: "checkpoint-1",
      sessionId: "session-1",
      label: "Before task 3",
      createdAt: 1,
      changedFiles: 0,
      kind: "turn-start" as const,
      turnIndex: 2,
      hasChanges: false,
      complete: true,
    };
    const development = {
      listCheckpoints: vi.fn().mockResolvedValue([]),
      createCheckpoint: vi.fn().mockResolvedValue(checkpoint),
      markCheckpointChanged: vi
        .fn()
        .mockResolvedValue({ ...checkpoint, hasChanges: true }),
    };
    const capability = {
      files: {},
      development,
    } as unknown as WorkspaceInspectorCapability;

    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <RecoveryProbe />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "begin task" }));
    await waitFor(() =>
      expect(development.createCheckpoint).toHaveBeenCalledWith(
        "session-1",
        "Before task 3",
        { kind: "turn-start", turnIndex: 2 },
      ),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "observe write" }),
    );
    await waitFor(() =>
      expect(development.markCheckpointChanged).toHaveBeenCalledWith(
        "session-1",
        "checkpoint-1",
      ),
    );
    expect(screen.getByLabelText("recovery points")).toHaveTextContent("1");
    expect(screen.getByLabelText("workspace open")).toHaveTextContent("false");
    expect(screen.getByLabelText("workspace tabs")).toHaveTextContent("0");
  });

  it("opens the linked execution view when the primary agent creates a durable task", async () => {
    const capability = { files: {} } as WorkspaceInspectorCapability;
    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <KanbanProbe />
      </WorkspacePaneProvider>,
    );

    expect(screen.getByLabelText("workspace open")).toHaveTextContent("false");
    expect(screen.getByLabelText("execution requests")).toHaveTextContent("0");

    await userEvent.click(
      screen.getByRole("button", { name: "observe durable task" }),
    );

    expect(screen.getByLabelText("workspace open")).toHaveTextContent("true");
    expect(screen.getByLabelText("execution requests")).toHaveTextContent("1");
  });

  it("does not expose review, outputs, or terminal as fixed workbench states", async () => {
    const capability = { files: {} } as WorkspaceInspectorCapability;
    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <Probe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "toggle workspace" }),
    );

    expect(
      screen.queryByRole("tab", { name: "workspacePane.review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "workspacePane.outputs" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "workspacePane.terminal" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the file tree beside the preview and lets it collapse", async () => {
    const files = {
      list: vi.fn().mockResolvedValue([
        {
          name: "App.tsx",
          path: "src/App.tsx",
          isDirectory: false,
          size: 14,
          modifiedAt: 1,
        },
      ]),
      search: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue({
        path: "/workspace/src/App.tsx",
        relativePath: "src/App.tsx",
        name: "App.tsx",
        content: "const app = 1;",
        size: 14,
        modifiedAt: 1,
        revision: "revision-1",
        truncated: false,
        binary: false,
      }),
      watch: vi.fn().mockReturnValue(() => {}),
      reveal: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn().mockResolvedValue(undefined),
    };
    const capability = { files } as unknown as WorkspaceInspectorCapability;
    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <FileProbe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "open file" }));

    await waitFor(() =>
      expect(files.read).toHaveBeenCalledWith("session-1", "src/App.tsx"),
    );
    expect(
      document.querySelector("[data-workspace-file-preview]"),
    ).not.toBeNull();
    expect(document.querySelector("[data-workspace-file-tree]")).not.toBeNull();
    expect(screen.getAllByText("src/App.tsx").length).toBeGreaterThan(0);

    const treeToggle = screen.getByRole("button", {
      name: "workspacePane.hideFileTree",
    });
    expect(treeToggle).toHaveClass("h-7", "w-7");
    expect(treeToggle.parentElement).toHaveClass("px-3");
    await userEvent.click(treeToggle);
    expect(document.querySelector("[data-workspace-file-tree]")).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: "workspacePane.showFileTree" }),
    );
    expect(document.querySelector("[data-workspace-file-tree]")).not.toBeNull();
  });

  it("keeps worktree management out of the file browser", async () => {
    const project = {
      id: "project-1",
      name: "workspace",
      folders: ["/workspace"],
      createdAt: 1,
      updatedAt: 1,
    };
    const development = {
      ensureProject: vi.fn().mockResolvedValue(project),
      listProjects: vi.fn().mockResolvedValue([project]),
      listWorktrees: vi.fn().mockResolvedValue([
        {
          path: "/private/session-isolation",
          branch: "agent/task-1",
        },
      ]),
      createWorktree: vi.fn(),
      listCheckpoints: vi.fn().mockResolvedValue([]),
      bindProjectLocation: vi.fn().mockResolvedValue(project),
    };
    const workspaces = {
      getCurrent: vi.fn().mockResolvedValue("/private/session-isolation"),
      onChange: vi.fn().mockReturnValue(() => {}),
      chooseDirectory: vi.fn().mockResolvedValue(null),
    };
    const files = {
      list: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
    };
    const capability = {
      files,
      development,
      workspaces,
    } as unknown as WorkspaceInspectorCapability;

    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <Probe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "toggle workspace" }),
    );
    const projectMenu = await screen.findByRole("button", {
      name: "workspacePane.switchProject",
    });
    const projectAdd = screen.getByRole("button", {
      name: "workspacePane.addFolder",
    });
    expect(projectAdd).toHaveClass("h-7", "w-7");
    expect(projectAdd.closest("[data-workspace-project-strip]")).toHaveClass(
      "px-3",
    );
    await userEvent.click(projectMenu);

    expect(screen.getByText("session-isolation")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("workspacePane.worktreeBranch"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "workspacePane.createWorktree" }),
    ).not.toBeInTheDocument();
    expect(development.listWorktrees).not.toHaveBeenCalled();
    expect(development.createWorktree).not.toHaveBeenCalled();
  });

  it("keeps the unchanged-lines disclosure out of the line-number gutter", async () => {
    const capability = {
      files: { read: vi.fn() },
    } as unknown as WorkspaceInspectorCapability;
    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <ReviewProbe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "open review" }));

    const disclosure = screen.getByRole("button", {
      name: "workspacePane.unmodifiedLines",
    });
    const [lineNumberGutter, contentCell] = Array.from(disclosure.children);
    expect(lineNumberGutter).toBeEmptyDOMElement();
    expect(contentCell?.querySelector("svg")).toBeInTheDocument();
    expect(contentCell).toHaveTextContent("workspacePane.unmodifiedLines");
  });

  it("switches between one line-number gutter and side-by-side gutters", async () => {
    const capability = {
      files: { read: vi.fn() },
    } as unknown as WorkspaceInspectorCapability;
    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <ReviewProbe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "open review" }));

    const unifiedToggle = screen.getByRole("button", {
      name: "workspacePane.unifiedDiff",
    });
    const splitToggle = screen.getByRole("button", {
      name: "workspacePane.splitDiff",
    });
    expect(unifiedToggle).toHaveAttribute("aria-pressed", "true");

    const unifiedRow = screen
      .getByText("old")
      .closest('[data-review-row="unified"]');
    expect(unifiedRow).not.toBeNull();
    expect(
      unifiedRow?.querySelectorAll("[data-review-line-number]"),
    ).toHaveLength(1);
    expect(
      document.querySelector('[data-review-scroll="unified"]'),
    ).toHaveClass("overflow-x-auto");

    await userEvent.click(splitToggle);

    expect(splitToggle).toHaveAttribute("aria-pressed", "true");
    const oldSplitRow = screen
      .getByText("old")
      .closest('[data-review-row="split"]');
    const newSplitRow = screen
      .getByText("new")
      .closest('[data-review-row="split"]');
    expect(oldSplitRow).not.toBeNull();
    expect(newSplitRow).not.toBeNull();
    expect(oldSplitRow).not.toBe(newSplitRow);
    expect(
      oldSplitRow?.querySelectorAll("[data-review-line-number]"),
    ).toHaveLength(1);
    expect(
      newSplitRow?.querySelectorAll("[data-review-line-number]"),
    ).toHaveLength(1);
    expect(oldSplitRow).toHaveAttribute("data-review-side", "old");
    expect(newSplitRow).toHaveAttribute("data-review-side", "new");
    const oldScroll = document.querySelector('[data-review-scroll="old"]');
    const newScroll = document.querySelector('[data-review-scroll="new"]');
    expect(oldScroll).toHaveClass("overflow-x-auto");
    expect(newScroll).toHaveClass("overflow-x-auto");
    expect(oldScroll).not.toBe(newScroll);
    expect(document.querySelector('[data-review-layout="split"]')).toHaveClass(
      "overflow-hidden",
    );
    (oldScroll as HTMLElement).scrollLeft = 180;
    fireEvent.scroll(oldScroll as HTMLElement);
    expect((newScroll as HTMLElement).scrollLeft).toBe(180);

    (newScroll as HTMLElement).scrollLeft = 72;
    fireEvent.scroll(newScroll as HTMLElement);
    expect((oldScroll as HTMLElement).scrollLeft).toBe(72);
    expect(screen.getAllByText("same context")).toHaveLength(2);
    expect(screen.getByText("workspacePane.beforeChange")).toBeInTheDocument();
    expect(screen.getByText("workspacePane.afterChange")).toBeInTheDocument();
  });

  it("previews resize directly and commits the width once dragging ends", async () => {
    const capability = {
      files: {},
    } as WorkspaceInspectorCapability;

    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <Probe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "toggle workspace" }),
    );

    const separator = screen.getByRole("separator");
    const pane = screen.getByLabelText("workspacePane.title");
    const container = pane.parentElement as HTMLElement;

    fireEvent(separator, pointerEvent("pointerdown", 500));
    fireEvent(separator, pointerEvent("pointermove", 400));

    expect(container.style.width).toBe("620px");
    expect(pane.style.width).toBe("620px");
    expect(screen.getByLabelText("workspace width")).toHaveTextContent("520");

    fireEvent(separator, pointerEvent("pointerup", 400));

    await waitFor(() => {
      expect(screen.getByLabelText("workspace width")).toHaveTextContent("620");
    });
  });
});
