import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  WorkspacePaneProvider,
  useWorkspacePane,
} from "../../../../packages/ui/src/chat/WorkspacePane";
import {
  WorkbenchExtensionsProvider,
  WorkbenchExtensionHosts,
} from "../../../../packages/ui/src/chat/workbench-extensions";
import { createBrowserView } from "./index.js";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
let browserView: ReturnType<typeof createBrowserView>;
function Harness({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  return (
    <WorkbenchExtensionsProvider extensions={[browserView]}>
      <WorkspacePaneProvider sessionId={sessionId}>
        <WorkbenchExtensionHosts>{children}</WorkbenchExtensionHosts>
      </WorkspacePaneProvider>
    </WorkbenchExtensionsProvider>
  );
}
function BrowserProbe() {
  const pane = useWorkspacePane();
  const activeResource = pane.activeTab?.resource;
  return (
    <>
      <output aria-label="visible tabs">
        {pane.tabs.filter((tab) => tab.resource.kind === "extension").length}
      </output>
      <output aria-label="all tabs">
        {pane.resources
          .map((tab) => `${tab.sessionId || "-"}`)
          .sort()
          .join(",")}
      </output>
      <output aria-label="visible active">
        {activeResource?.kind === "extension" ? activeResource.resource.id : ""}
      </output>
      <output aria-label="visible active kind">
        {activeResource?.kind ?? ""}
      </output>
      <output aria-label="open">{String(pane.open)}</output>
    </>
  );
}

describe("a browser tab belongs to the session that asked for it", () => {
  const platform = {} as Record<string, unknown>;
  const previous = platform.embeddedBrowser;
  afterEach(() => {
    platform.embeddedBrowser = previous;
  });

  function installAdapter() {
    let create: ((event: { sessionId?: string }) => void) | null = null;
    let focus: ((event: { tabId: string; sessionId?: string }) => void) | null =
      null;
    platform.embeddedBrowser = {
      onCreateRequested: (
        listener: (event: { sessionId?: string }) => void,
      ) => {
        create = listener;
        return () => {};
      },
      onFocusRequested: (
        listener: (event: { tabId: string; sessionId?: string }) => void,
      ) => {
        focus = listener;
        return () => {};
      },
      onAgentActivity: () => () => {},
      unregisterTab: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn().mockResolvedValue({}),
    };
    browserView = createBrowserView(platform.embeddedBrowser as never);
    return {
      requestTab: (sessionId?: string) => act(() => create?.({ sessionId })),
      focusTab: (tabId: string, sessionId?: string) =>
        act(() => focus?.({ tabId, sessionId })),
    };
  }

  it("does not open a background task's page in the workbench on screen", () => {
    const adapter = installAdapter();
    render(
      <Harness sessionId="session-visible">
        <BrowserProbe />
      </Harness>,
    );
    expect(screen.getByLabelText("open")).toHaveTextContent("false");

    // The steward dispatched a task into a session nobody is looking at, and
    // its agent called the browser tool. The tab must land there.
    adapter.requestTab("session-background");
    expect(screen.getByLabelText("all tabs")).toHaveTextContent(
      "session-background",
    );
    expect(screen.getByLabelText("visible tabs")).toHaveTextContent("0");
    expect(screen.getByLabelText("visible active")).toHaveTextContent("");
    expect(screen.getByLabelText("open")).toHaveTextContent("false");

    // The user's own "open browser" still lands in front of them.
    adapter.requestTab(undefined);
    expect(screen.getByLabelText("visible tabs")).toHaveTextContent("1");
    expect(screen.getByLabelText("visible active kind")).toHaveTextContent(
      "extension",
    );
    expect(screen.getByLabelText("open")).toHaveTextContent("true");
    expect(screen.getByLabelText("all tabs")).toHaveTextContent(
      "session-background,session-visible",
    );
  });

  it("keeps a focus request inside the owning session", () => {
    const adapter = installAdapter();
    const { rerender } = render(
      <Harness sessionId="session-visible">
        <BrowserProbe />
      </Harness>,
    );

    adapter.requestTab("session-background");
    adapter.requestTab("session-visible");
    const visibleTabId = screen.getByLabelText("visible active").textContent;
    expect(visibleTabId).toBeTruthy();

    // Main is about to drive the background session's tab. Bringing it
    // forward must not steal the tab the user is looking at.
    const backgroundTabId = "not-a-tab-of-the-visible-session";
    adapter.focusTab(backgroundTabId, "session-background");
    expect(screen.getByLabelText("visible active")).toHaveTextContent(
      visibleTabId as string,
    );

    // Switching to the background task finds its own browser waiting, open.
    act(() => {
      rerender(
        <Harness sessionId="session-background">
          <BrowserProbe />
        </Harness>,
      );
    });
    expect(screen.getByLabelText("visible tabs")).toHaveTextContent("1");
    expect(screen.getByLabelText("open")).toHaveTextContent("true");
  });
});
