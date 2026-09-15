import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import type { WorkbenchViewExtension } from "@amiba/extension-sdk";
import {
  WorkbenchExtensionsProvider,
  useWorkbenchShell,
} from "../workbench-extensions";
import {
  WorkspacePane,
  WorkspacePaneProvider,
  WorkspacePaneToggle,
} from "../WorkspacePane";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
let sequence = 0;
const extension: WorkbenchViewExtension = {
  id: "test.tool",
  resourceType: "test.tool",
  order: 100,
  component: ({ resource }) => <div>Body {resource.id}</div>,
  launcher: {
    label: () => "Open tool",
    createResource: () => ({
      type: "test.tool",
      id: String(++sequence),
      title: `Tool ${sequence}`,
    }),
  },
};
function App({
  sessionId = "one",
  extensions = [extension],
}: {
  sessionId?: string;
  extensions?: WorkbenchViewExtension[];
}) {
  return (
    <WorkbenchExtensionsProvider extensions={extensions}>
      <WorkspacePaneProvider
        sessionId={sessionId}
        capability={{ files: {} } as any}
      >
        <WorkspacePaneToggle />
        <WorkspacePane />
      </WorkspacePaneProvider>
    </WorkbenchExtensionsProvider>
  );
}
it("uses one contribution for the empty state and + popup, restores session tabs, and returns to empty after closing", async () => {
  const user = userEvent.setup();
  const app = render(<App />);
  await user.click(screen.getByRole("button", { name: "workspacePane.open" }));
  expect(screen.queryByRole("tab")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "workspacePane.newTab" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Open tool" }));
  expect(screen.getAllByRole("tab")).toHaveLength(1);
  await user.click(
    screen.getByRole("button", { name: "workspacePane.newTab" }),
  );
  await user.click(screen.getByRole("button", { name: "Open tool" }));
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Open tool" })).toBeNull();
  app.rerender(<App sessionId="two" />);
  await user.click(screen.getByRole("button", { name: "workspacePane.open" }));
  expect(screen.queryByRole("tab")).toBeNull();
  app.rerender(<App />);
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  await user.click(screen.getAllByRole("button", { name: "common.close" })[1]);
  await user.click(screen.getByRole("button", { name: "common.close" }));
  expect(screen.queryByRole("tab")).toBeNull();
  expect(screen.getByRole("button", { name: "Open tool" })).toBeVisible();
}, 15000);
it("removes uninstalled actions and keeps unavailable resource tabs", async () => {
  const user = userEvent.setup();
  const app = render(<App />);
  await user.click(screen.getByRole("button", { name: "workspacePane.open" }));
  await user.click(screen.getByRole("button", { name: "Open tool" }));
  app.rerender(<App extensions={[]} />);
  expect(screen.getAllByRole("tab")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "workspacePane.viewUnavailable",
  );
  expect(
    screen.queryByRole("button", { name: "workspacePane.newTab" }),
  ).toBeNull();
});
it("awaits plugin cleanup and leaves a failed close available for retry", async () => {
  const onClose = vi
    .fn()
    .mockRejectedValueOnce(new Error("stop failed"))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<App extensions={[{ ...extension, onClose }]} />);
  await user.click(screen.getByRole("button", { name: "workspacePane.open" }));
  await user.click(screen.getByRole("button", { name: "Open tool" }));
  await user.click(screen.getByRole("button", { name: "common.close" }));
  expect(screen.getByRole("alert")).toHaveTextContent("stop failed");
  expect(screen.getByRole("tab")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "common.close" }));
  await waitFor(() => expect(screen.queryByRole("tab")).toBeNull());
  expect(onClose).toHaveBeenCalledTimes(2);
});
it("mounts the framework only while its plugin contribution is installed", () => {
  function Seat() {
    const shell = useWorkbenchShell();
    const View = shell?.component;
    return View ? <View /> : null;
  }
  const shell = {
    id: "workbench",
    order: 100,
    component: () => <div>Workbench framework</div>,
    toggle: () => null,
  };
  const app = render(
    <WorkbenchExtensionsProvider extensions={[]} shells={[shell]}>
      <Seat />
    </WorkbenchExtensionsProvider>,
  );
  expect(screen.getByText("Workbench framework")).toBeInTheDocument();
  app.rerender(
    <WorkbenchExtensionsProvider extensions={[]}>
      <Seat />
    </WorkbenchExtensionsProvider>,
  );
  expect(screen.queryByText("Workbench framework")).toBeNull();
});
