import type { ComponentProps } from "react";
import { DirectoryChooserContext } from "../../directory-chooser";
import type { WorkbenchViewProps } from "@amiba/extension-sdk";
import { WorkbenchExtensionsProvider } from "../workbench-extensions";
import { WorkspaceFileView } from "../../../../../plugins/dsh-plugin-file-preview/src/client/FileView";
import { defaultFileRenderers } from "../../../../../plugins/dsh-plugin-file-preview/src/client/defaults";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import {
  WorkspacePane,
  WorkspacePaneProvider as HostProvider,
  WorkspaceFileWorkspace,
  builtinWorkbenchViews,
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

function FileContribution({
  resource,
  sessionId,
  openFile,
}: WorkbenchViewProps) {
  const pane = useWorkspacePane();
  if (!pane.files) return null;
  const file =
    resource.type === "file"
      ? (resource.data as { kind: "file"; path: string; line?: number })
      : null;
  return (
    <WorkspaceFileWorkspace
      resource={file}
      sessionId={sessionId}
      files={pane.files}
      development={pane.development}
      workspaces={pane.workspaces}
      openFile={openFile}
      treeOpen={pane.fileTreeOpen}
      onTreeOpenChange={pane.setFileTreeOpen}
      renderPreview={(target) => (
        <WorkspaceFileView
          resource={target}
          sessionId={sessionId}
          files={pane.files!}
          renderers={defaultFileRenderers}
          showHeader={false}
        />
      )}
    />
  );
}
const testViews = [
  ...builtinWorkbenchViews,
  ...["file", "files"].map((resourceType) => ({
    id: resourceType,
    resourceType,
    order: 100,
    component: FileContribution,
  })),
];
function WorkspacePaneProvider(props: ComponentProps<typeof HostProvider>) {
  return (
    <WorkbenchExtensionsProvider extensions={testViews}>
      <HostProvider {...props} />
    </WorkbenchExtensionsProvider>
  );
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
            tool: "write",
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

  it("opens plugin panels in the workbench and restores each session's selection", async () => {
    const capability = { files: {} } as WorkspaceInspectorCapability;
    function TestPane({ sessionId }: { sessionId: string }) {
      return (
        <WorkspacePaneProvider sessionId={sessionId} capability={capability}>
          <Probe />
          <WorkspacePane
            renderPanel={(owner) =>
              owner.placement === "tab" ? (
                <button
                  role="tab"
                  aria-selected={owner.activePanel === "example"}
                  onClick={() => owner.openPanel("example")}
                >
                  Plugin panel
                </button>
              ) : (
                <div>Plugin content: {owner.activePanel}</div>
              )
            }
          />
        </WorkspacePaneProvider>
      );
    }
    const view = render(<TestPane sessionId="plugin-session-one" />);
    fireEvent.click(screen.getByText("Plugin panel"));
    expect(screen.getByText("Plugin content: example")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "toggle workspace" }),
    ).toHaveAttribute("aria-pressed", "true");
    view.rerender(<TestPane sessionId="plugin-session-two" />);
    expect(screen.queryByText("Plugin content: example")).toBeNull();
    view.rerender(<TestPane sessionId="plugin-session-one" />);
    expect(screen.getByText("Plugin content: example")).toBeInTheDocument();
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

    );
    expect(screen.getByRole("separator")).toHaveAttribute("tabindex", "0");

    await userEvent.click(openEdgeToggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("prepares and marks an addressed background checkpoint without changing the foreground pane", async () => {
    const checkpoint = { id: "background-point", sessionId: "background", label: "Before task 5", createdAt: 1,
      changedFiles: 0, kind: "turn-start" as const, turnIndex: 4, hasChanges: false, complete: true };
    let finish!: (value: typeof checkpoint) => void;
    let stored: typeof checkpoint[] = [];
    const development = {
      listCheckpoints: vi.fn(async (id: string) => id === "background" ? stored : []),
      createCheckpoint: vi.fn(() => new Promise<typeof checkpoint>(resolve => { finish = resolve; })
        .then(value => { stored = [value]; return value; })),
      markCheckpointChanged: vi.fn(async () => { stored = [{ ...checkpoint, hasChanges: true }]; return stored[0]; }),
    };
    const capability = { files: {}, development } as unknown as WorkspaceInspectorCapability;
    let pane!: ReturnType<typeof useWorkspacePane>;
    function AddressProbe() { pane = useWorkspacePane(); return <RecoveryProbe />; }
    const view = (id: string) => <WorkspacePaneProvider capability={capability} sessionId={id}><AddressProbe /></WorkspacePaneProvider>;
    const { rerender } = render(view("front"));
    let pending!: Promise<void>;
    act(() => { pending = pane.beginTurnFor("background", 4); });
    expect(development.createCheckpoint).toHaveBeenCalledWith("background", "Before task 5", { kind: "turn-start", turnIndex: 4 });
    rerender(view("different-front"));
    await act(async () => { finish(checkpoint); await pending; });
    expect(pane.checkpoints).toEqual([]);
    expect(pane.open).toBe(false);
    expect(pane.tabs).toEqual([]);
    act(() => pane.observeToolEvent({ tool: "write", toolCallId: "background-write", status: "completed", args: { path: "file" } }, "background"));
    await waitFor(() => expect(development.markCheckpointChanged).toHaveBeenCalledWith("background", "background-point"));
    expect(pane.checkpoints).toEqual([]);
    rerender(view("background"));
    await waitFor(() => expect(pane.checkpoints).toEqual([{ ...checkpoint, hasChanges: true }]));
    expect(pane.open).toBe(false);
    expect(pane.tabs).toEqual([]);
  });

  it.each(["success", "failure", "not-git"])("does not let an older %s replace a newer background turn's checkpoint", async outcome => {
    const checkpoint = { id: "latest", sessionId: "background", label: "Before task 2", createdAt: 2,
      changedFiles: 0, kind: "turn-start" as const, turnIndex: 1, hasChanges: false, complete: true };
    let finish!: (value: typeof checkpoint | null) => void, fail!: (error: Error) => void;
    const first = new Promise<typeof checkpoint | null>((resolve, reject) => { finish = resolve; fail = reject; });
    const development = {
      listCheckpoints: vi.fn(async () => []),
      createCheckpoint: vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(checkpoint),
      markCheckpointChanged: vi.fn(async () => ({ ...checkpoint, hasChanges: true })),
    };
    const capability = { files: {}, development } as unknown as WorkspaceInspectorCapability;
    let pane!: ReturnType<typeof useWorkspacePane>;
    function AddressProbe() { pane = useWorkspacePane(); return null; }
    render(<WorkspacePaneProvider capability={capability} sessionId="front"><AddressProbe /></WorkspacePaneProvider>);
    let older!: Promise<void>;
    act(() => { older = pane.beginTurnFor("background", 0); });
    await act(async () => { await pane.beginTurnFor("background", 1); });
    await act(async () => {
      if (outcome === "failure") fail(new Error("late failure"));
      else finish(outcome === "not-git" ? null : { ...checkpoint, id: "older", turnIndex: 0, createdAt: 1 });
      await older;
    });
    act(() => pane.observeToolEvent({ tool: "write", toolCallId: "write", status: "completed", args: { path: "file" } }, "background"));
    await waitFor(() => expect(development.markCheckpointChanged).toHaveBeenCalledWith("background", "latest"));
    expect(pane.checkpoints).toEqual([]);
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
    // The tree starts CLOSED: the pane opens to show a preview, and a
    // directory listing unfolding beside it by default read as clutter.
    expect(document.querySelector("[data-workspace-file-tree]")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "workspacePane.showFileTree" }),
    );
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
      <DirectoryChooserContext.Provider value={{ workspace: async (defaultPath, adopt) => {
        const selected = await workspaces.chooseDirectory(defaultPath);
        if (selected) await adopt(selected);
        return selected;
      } }}>
        <WorkspacePaneProvider capability={capability} sessionId="session-1">
          <Probe />
          <WorkspacePane />
        </WorkspacePaneProvider>
      </DirectoryChooserContext.Provider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "toggle workspace" }),
    );
    // The project strip lives in the file tree, which now starts closed.
    await userEvent.click(
      await screen.findByRole("button", { name: "workspacePane.showFileTree" }),
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
  it("allows a large preview, fits smaller windows and restores the preferred width", async () => {
    const previous = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {configurable: true, value: 2000});
    const view = render(<WorkspacePaneProvider capability={{files:{}} as WorkspaceInspectorCapability} sessionId="wide-session"><Probe/><WorkspacePane/></WorkspacePaneProvider>);
    try {
      fireEvent.click(screen.getByRole("button", {name: "toggle workspace"}));
      const separator = screen.getByRole("separator");
      fireEvent.keyDown(separator, {key: "End"});
      expect(screen.getByLabelText("workspace width")).toHaveTextContent("1680");
      expect(screen.getByLabelText("workspacePane.title").style.width).toBe("1680px");
      Object.defineProperty(window, "innerWidth", {configurable: true, value: 1000});
      fireEvent(window, new Event("resize"));
      expect(screen.getByLabelText("workspacePane.title").style.width).toBe("680px");
      Object.defineProperty(window, "innerWidth", {configurable: true, value: 2000});
      fireEvent(window, new Event("resize"));
      expect(screen.getByLabelText("workspacePane.title").style.width).toBe("1680px");
    } finally {view.unmount(); Object.defineProperty(window,"innerWidth",{configurable:true,value:previous});}
  });
  it("shields web content while dragging and rolls back cancelled resizing", () => {
    render(<WorkspacePaneProvider capability={{files:{}} as WorkspaceInspectorCapability} sessionId="cancel-session"><Probe/><WorkspacePane/></WorkspacePaneProvider>);
    fireEvent.click(screen.getByRole("button", {name: "toggle workspace"}));
    const separator = screen.getByRole("separator");
    const pane = screen.getByLabelText("workspacePane.title");
    fireEvent(separator,pointerEvent("pointerdown",500));
    expect(document.querySelector("[data-workspace-resize-shield]")).toBeInTheDocument();
    fireEvent(separator,pointerEvent("pointermove",400));
    expect(pane.style.width).toBe("620px");
    fireEvent(separator,pointerEvent("pointercancel",400));
    expect(pane.style.width).toBe("520px");
    expect(document.querySelector("[data-workspace-resize-shield]")).toBeNull();
    expect(screen.getByLabelText("workspace width")).toHaveTextContent("520");
  });

});
