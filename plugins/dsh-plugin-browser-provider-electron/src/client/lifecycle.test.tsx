import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkbenchViewExtension } from "@amiba/extension-sdk";
import {
  WorkspacePaneProvider,
  useWorkspacePane,
} from "../../../../packages/ui/src/chat/WorkspacePane";
import {
  WorkbenchExtensionsProvider,
  WorkbenchExtensionHosts,
  WorkbenchExtensionToolbar,
  WorkbenchResourceView,
} from "../../../../packages/ui/src/chat/workbench-extensions";
import { createBrowserView } from "./index.js";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
const platform = {} as Record<string, unknown>;
const previous = platform.embeddedBrowser;
afterEach(() => {
  platform.embeddedBrowser = previous;
});
function Probe() {
  const pane = useWorkspacePane();
  const active = pane.activeTab?.resource;
  return (
    <>
      <input aria-label="chat draft" defaultValue="" />
      <WorkbenchExtensionToolbar />
      <button onClick={() => pane.openUrl("https://example.com")}>URL</button>
      <output aria-label="resources">{pane.resources.length}</output>
      {active?.kind === "extension" && (
        <WorkbenchResourceView
          resource={active.resource}
          sessionId={pane.sessionId}
          openResource={pane.openResource}
          openFile={pane.openFile}
        />
      )}
    </>
  );
}
function App({ extensions }: { extensions: WorkbenchViewExtension[] }) {
  return (
    <WorkbenchExtensionsProvider extensions={extensions}>
      <WorkspacePaneProvider sessionId="a">
        <WorkbenchExtensionHosts>
          <Probe />
        </WorkbenchExtensionHosts>
      </WorkspacePaneProvider>
    </WorkbenchExtensionsProvider>
  );
}
it("unmounts surfaces and listeners on removal, restores resources on reinstall, and elects a replacement", async () => {
  const stopCreate = vi.fn(),
    stopFocus = vi.fn(),
    unregisterTab = vi.fn().mockResolvedValue(undefined);
  platform.embeddedBrowser = {
    onCreateRequested: () => stopCreate,
    onFocusRequested: () => stopFocus,
    onAgentActivity: () => () => {},
    unregisterTab,
    setActiveTab: vi.fn().mockResolvedValue({}),
    detectDevServers: vi.fn().mockResolvedValue([]),
    command: vi.fn().mockResolvedValue({}),
  };
  const browserView = createBrowserView(platform.embeddedBrowser as never);
  const app = render(<App extensions={[browserView]} />);
  expect(
    screen.getByRole("button", { name: "Open browser" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("chat draft"), {
    target: { value: "keep my draft" },
  });
  fireEvent.click(screen.getByText("URL"));
  expect(document.querySelectorAll("webview")).toHaveLength(1);
  app.rerender(<App extensions={[]} />);
  expect(screen.getByLabelText("chat draft")).toHaveValue("keep my draft");
  expect(document.querySelectorAll("webview")).toHaveLength(0);
  expect(stopCreate).toHaveBeenCalled();
  expect(stopFocus).toHaveBeenCalled();
  expect(unregisterTab).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: /Open browser|Close browser/ }),
  ).toBeNull();
  expect(screen.getByLabelText("resources")).toHaveTextContent("1");
  expect(screen.getByText("workspacePane.viewUnavailable")).toBeInTheDocument();
  app.rerender(<App extensions={[browserView]} />);
  expect(document.querySelectorAll("webview")).toHaveLength(1);
  const replacement: WorkbenchViewExtension = {
    id: "other.browser",
    resourceType: "browser",
    order: 0,
    component: () => <p>Replacement browser</p>,
    toolbar: () => <button>Replacement action</button>,
  };
  app.rerender(<App extensions={[browserView, replacement]} />);
  expect(screen.getByLabelText("chat draft")).toHaveValue("keep my draft");
  expect(document.querySelectorAll("webview")).toHaveLength(0);
  expect(screen.getByText("Replacement browser")).toBeInTheDocument();
  expect(screen.getByText("Replacement action")).toBeInTheDocument();
  expect(unregisterTab).toHaveBeenCalledTimes(2);
  await act(async () => {});
});
