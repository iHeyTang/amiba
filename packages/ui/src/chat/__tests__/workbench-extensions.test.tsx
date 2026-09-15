import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { WorkbenchViewExtension } from "@amiba/extension-sdk";
import {
  WorkbenchExtensionsProvider,
  WorkbenchResourceView,
} from "../workbench-extensions";
import { WorkspacePaneProvider, useWorkspacePane } from "../WorkspacePane";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
const resource = {
  type: "third-party.chart",
  id: "chart-1",
  title: "Chart",
  data: { value: 42 },
};
const props = {
  resource,
  sessionId: "s1",
  openResource: vi.fn(),
  openFile: vi.fn(),
};
it("renders an unknown resource type without changing the host and reacts to removal", () => {
  const extension: WorkbenchViewExtension = {
    id: "chart",
    resourceType: resource.type,
    order: 0,
    component: ({ resource }) => <div>{(resource.data as any).value}</div>,
  };
  const view = render(
    <WorkbenchExtensionsProvider extensions={[extension]}>
      <WorkbenchResourceView {...props} />
    </WorkbenchExtensionsProvider>,
  );
  expect(screen.getByText("42")).toBeInTheDocument();
  view.rerender(
    <WorkbenchExtensionsProvider extensions={[]}>
      <WorkbenchResourceView {...props} />
    </WorkbenchExtensionsProvider>,
  );
  expect(screen.queryByText("42")).toBeNull();
  expect(screen.getByRole("status")).toBeInTheDocument();
  view.rerender(
    <WorkbenchExtensionsProvider extensions={[extension]}>
      <WorkbenchResourceView {...props} />
    </WorkbenchExtensionsProvider>,
  );
  expect(screen.getByText("42")).toBeInTheDocument();
});
it("isolates a broken view from the workbench", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <WorkbenchExtensionsProvider
      extensions={[
        {
          id: "broken",
          resourceType: resource.type,
          order: 0,
          component: () => {
            throw new Error("broken");
          },
        },
      ]}
    >
      <WorkbenchResourceView {...props} />
    </WorkbenchExtensionsProvider>,
  );
  expect(screen.getByRole("status")).toBeInTheDocument();
  error.mockRestore();
});
it("opens custom resources without filesystem access and preserves per-session tabs", () => {
  function Probe() {
    const pane = useWorkspacePane();
    return (
      <>
        <button onClick={() => pane.openResource(resource)}>open chart</button>
        <output>
          {pane.tabs.length}:{String(pane.open)}:{pane.activeTab?.resource.kind}
        </output>
      </>
    );
  }
  const extension = {
    id: "chart",
    resourceType: resource.type,
    order: 0,
    component: () => null,
  };
  function App({ sessionId }: { sessionId: string }) {
    return (
      <WorkbenchExtensionsProvider extensions={[extension]}>
        <WorkspacePaneProvider sessionId={sessionId}>
          <Probe />
        </WorkspacePaneProvider>
      </WorkbenchExtensionsProvider>
    );
  }
  const view = render(<App sessionId="a" />);
  fireEvent.click(screen.getByText("open chart"));
  expect(screen.getByRole("status")).toHaveTextContent("1:true:extension");
  fireEvent.click(screen.getByText("open chart"));
  expect(screen.getByRole("status")).toHaveTextContent("1:true:extension");
  view.rerender(<App sessionId="b" />);
  expect(screen.getByRole("status")).toHaveTextContent("0:false:");
  view.rerender(<App sessionId="a" />);
  expect(screen.getByRole("status")).toHaveTextContent("1:true:extension");
});

it("reuses an opted-in view within a session and keeps other views resource-scoped", () => {
  function View() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>count {count}</button>;
  }
  const shared = ["file", "files"].map((type) => ({
    id: type,
    resourceType: type,
    order: 0,
    component: View,
    instanceKey: "explorer",
  }));
  const ordinary = {
    id: "chart",
    resourceType: "chart",
    order: 0,
    component: View,
  };
  const tree = (type: string, id: string, sessionId = "s1") => (
    <WorkbenchExtensionsProvider extensions={[...shared, ordinary]}>
      <WorkbenchResourceView
        {...props}
        sessionId={sessionId}
        resource={{ type, id, title: id }}
      />
    </WorkbenchExtensionsProvider>
  );
  const view = render(tree("files", "files"));
  fireEvent.click(screen.getByText("count 0"));
  view.rerender(tree("file", "a"));
  expect(screen.getByText("count 1")).toBeInTheDocument();
  view.rerender(tree("file", "b"));
  expect(screen.getByText("count 1")).toBeInTheDocument();
  view.rerender(tree("file", "b", "s2"));
  expect(screen.getByText("count 0")).toBeInTheDocument();
  view.rerender(tree("chart", "a"));
  fireEvent.click(screen.getByText("count 0"));
  view.rerender(tree("chart", "b"));
  expect(screen.getByText("count 0")).toBeInTheDocument();
});
