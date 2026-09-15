import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type {
  WorkbenchResource,
  WorkbenchViewProps,
} from "@amiba/extension-sdk";
import type {
  WorkspaceFilesAdapter,
  WorkspaceDevelopmentAdapter,
  WorkspaceAdapter,
} from "@amiba/app-runtime/platform";
import { WorkspaceFileWorkspace } from "../WorkspacePane";
import {
  WorkbenchExtensionsProvider,
  WorkbenchResourceView,
} from "../workbench-extensions";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));

it("shares the explorer across file tabs, preserving navigation and showing the actual directory", async () => {
  const docs = { name: "docs", path: "docs", isDirectory: true };
  const first = { name: "first.md", path: "docs/first.md", isDirectory: false };
  const second = {
    name: "second.md",
    path: "docs/second.md",
    isDirectory: false,
  };
  const files = {
    list: vi.fn(async (_session: string, path?: string) =>
      path === "docs" ? [first, second] : [docs],
    ),
    search: vi.fn(async () => [first, second]),
  } as unknown as WorkspaceFilesAdapter;
  const project = {
    id: "home",
    name: "zhangdehui",
    folders: ["/Users/zhangdehui"],
  };
  const development = {
    ensureProject: vi.fn(async () => project),
    listProjects: vi.fn(async () => [project]),
  } as unknown as WorkspaceDevelopmentAdapter;
  const workspaces = {
    getCurrent: vi.fn(async () => "/Users/zhangdehui/mofli"),
    onChange: vi.fn(() => () => {}),
  } as unknown as WorkspaceAdapter;
  function FileView({ resource, sessionId, openFile }: WorkbenchViewProps) {
    const [treeOpen, setTreeOpen] = useState(true);
    return (
      <WorkspaceFileWorkspace
        resource={
          resource.type === "file"
            ? (resource.data as { kind: "file"; path: string })
            : null
        }
        sessionId={sessionId}
        files={files}
        development={development}
        workspaces={workspaces}
        openFile={openFile}
        treeOpen={treeOpen}
        onTreeOpenChange={setTreeOpen}
        renderPreview={(target) => (
          <output data-testid="preview">{target.path}</output>
        )}
      />
    );
  }
  const extensions = ["files", "file"].map((type) => ({
    id: type,
    resourceType: type,
    order: 0,
    instanceKey: "shared-files",
    component: FileView,
  }));
  function App() {
    const [resource, setResource] = useState<WorkbenchResource>({
      type: "files",
      id: "files",
      title: "Files",
    });
    const openFile = (path: string) =>
      setResource({
        type: "file",
        id: path,
        title: path,
        data: { kind: "file", path },
      });
    return (
      <WorkbenchExtensionsProvider extensions={extensions}>
        <button
          onClick={() => openFile("/Users/zhangdehui/mofli/docs/first.md")}
        >
          select absolute file
        </button>
        <WorkbenchResourceView
          sessionId="session"
          resource={resource}
          openResource={setResource}
          openFile={openFile}
        />
      </WorkbenchExtensionsProvider>
    );
  }
  render(<App />);
  await screen.findByText("mofli");
  expect(
    screen.getByRole("button", { name: "workspacePane.switchProject" }),
  ).toHaveAttribute("title", "/Users/zhangdehui/mofli");
  fireEvent.click(await screen.findByRole("button", { name: "docs" }));
  const tree = document.querySelector<HTMLElement>(
    "[data-workspace-file-tree]",
  )!;
  const viewport = tree.querySelector<HTMLElement>(
    "[data-radix-scroll-area-viewport]",
  )!;
  viewport.scrollTop = 130;
  fireEvent.click(
    await within(tree).findByRole("button", { name: "first.md" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("preview")).toHaveTextContent("docs/first.md"),
  );
  expect(document.querySelector("[data-workspace-file-tree]")).toBe(tree);
  expect(viewport.scrollTop).toBe(130);
  expect(within(tree).getByRole("button", { name: "docs" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  fireEvent.click(within(tree).getByRole("button", { name: "second.md" }));
  expect(
    within(tree).getByRole("button", { name: "second.md" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    within(tree).getByRole("button", { name: "first.md" }),
  ).not.toHaveAttribute("aria-current");
  expect(files.list).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByText("select absolute file"));
  expect(
    within(tree).getByRole("button", { name: "first.md" }),
  ).toHaveAttribute("aria-current", "page");
  fireEvent.change(screen.getByPlaceholderText("workspacePane.searchFiles"), {
    target: { value: ".md" },
  });
  await waitFor(() => expect(files.search).toHaveBeenCalled());
  fireEvent.click(
    await within(tree).findByRole("button", { name: "second.md" }),
  );
  expect(screen.getByPlaceholderText("workspacePane.searchFiles")).toHaveValue(
    ".md",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "workspacePane.hideFileTree" }),
  );
  expect(tree).not.toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "workspacePane.showFileTree" }),
  );
  expect(document.querySelector("[data-workspace-file-tree]")).toBe(tree);
  expect(screen.getByPlaceholderText("workspacePane.searchFiles")).toHaveValue(
    ".md",
  );
});
