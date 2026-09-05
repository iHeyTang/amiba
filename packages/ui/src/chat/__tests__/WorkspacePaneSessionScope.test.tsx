import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { getPlatform } from "@amiba/app-runtime/platform";

import { WorkspacePaneProvider, useWorkspacePane } from "../WorkspacePane";
import type { WorkspaceInspectorCapability } from "../internal/capabilities";

function Probe() {
  const pane = useWorkspacePane();
  return (
    <>
      <button type="button" onClick={pane.toggle}>
        toggle workbench
      </button>
      <button type="button" onClick={() => pane.openFile("src/App.tsx")}>
        open file
      </button>
      <button type="button" onClick={() => pane.setMode("files")}>
        show files
      </button>
      <button type="button" onClick={() => pane.setFileTreeOpen(true)}>
        show tree
      </button>
      <button type="button" onClick={() => pane.setTerminalOpen(true)}>
        open terminal
      </button>
      <output aria-label="open">{String(pane.open)}</output>
      <output aria-label="tabs">{pane.tabs.length}</output>
      <output aria-label="mode">{pane.mode}</output>
      <output aria-label="tree">{String(pane.fileTreeOpen)}</output>
      <output aria-label="terminal">{String(pane.terminalOpen)}</output>
    </>
  );
}

function Harness({ sessionId }: { sessionId: string }) {
  const capability = { files: {} } as WorkspaceInspectorCapability;
  return (
    <WorkspacePaneProvider capability={capability} sessionId={sessionId}>
      <Probe />
    </WorkspacePaneProvider>
  );
}

function snapshot() {
  return {
    open: screen.getByLabelText("open").textContent,
    tabs: screen.getByLabelText("tabs").textContent,
    mode: screen.getByLabelText("mode").textContent,
    tree: screen.getByLabelText("tree").textContent,
    terminal: screen.getByLabelText("terminal").textContent,
  };
}

describe("workbench state is owned by the session", () => {
  it("does not carry one session's workbench over to another", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness sessionId="session-1" />);

    await user.click(screen.getByRole("button", { name: "open file" }));
    await user.click(screen.getByRole("button", { name: "show tree" }));
    await user.click(screen.getByRole("button", { name: "open terminal" }));
    expect(snapshot()).toEqual({
      open: "true",
      tabs: "1",
      mode: "preview",
      tree: "true",
      terminal: "true",
    });

    // Switching to a task that never opened its workbench lands on a closed,
    // empty workbench — not the previous task's.
    await act(async () => {
      rerender(<Harness sessionId="session-2" />);
    });
    expect(snapshot()).toEqual({
      open: "false",
      tabs: "0",
      mode: "files",
      tree: "false",
      terminal: "false",
    });

    // What the second task does stays with it.
    await user.click(screen.getByRole("button", { name: "toggle workbench" }));
    await user.click(screen.getByRole("button", { name: "show files" }));
    expect(snapshot()).toMatchObject({
      open: "true",
      tabs: "0",
      mode: "files",
    });

    // Coming back restores the first task's workbench exactly as it was left.
    await act(async () => {
      rerender(<Harness sessionId="session-1" />);
    });
    expect(snapshot()).toEqual({
      open: "true",
      tabs: "1",
      mode: "preview",
      tree: "true",
      terminal: "true",
    });

    // Closing it in one task does not close it in another.
    await user.click(screen.getByRole("button", { name: "toggle workbench" }));
    expect(snapshot()).toMatchObject({ open: "false" });
    await act(async () => {
      rerender(<Harness sessionId="session-2" />);
    });
    expect(snapshot()).toMatchObject({ open: "true", mode: "files" });
  });

  it("does not persist the open state as a global preference", async () => {
    const { getPlatform } = await import("@amiba/app-runtime/platform");
    const set = vi.spyOn(getPlatform().storage, "set");
    const user = userEvent.setup();
    render(<Harness sessionId="session-1" />);

    await user.click(screen.getByRole("button", { name: "toggle workbench" }));
    expect(snapshot()).toMatchObject({ open: "true" });

    expect(
      set.mock.calls.some(
        (call) => "settings.chat.workspacePaneOpen" in (call[0] ?? {}),
      ),
    ).toBe(false);
    set.mockRestore();
  });
});

function BrowserProbe() {
  const pane = useWorkspacePane();
  const activeResource = pane.activeTab?.resource;
  return (
    <>
      <output aria-label="visible tabs">
        {pane.tabs.filter((tab) => tab.resource.kind === "browser").length}
      </output>
      <output aria-label="all tabs">
        {pane.browserTabs
          .map((tab) => `${tab.sessionId || "-"}`)
          .sort()
          .join(",")}
      </output>
      <output aria-label="visible active">
        {pane.visibleBrowserTabId ?? ""}
      </output>
      <output aria-label="visible active kind">
        {activeResource?.kind ?? ""}
      </output>
      <output aria-label="open">{String(pane.open)}</output>
    </>
  );
}

describe("a browser tab belongs to the session that asked for it", () => {
  const platform = getPlatform() as unknown as Record<string, unknown>;
  const previous = platform.embeddedBrowser;
  afterEach(() => {
    platform.embeddedBrowser = previous;
  });

  function installAdapter() {
    let create: ((event: { sessionId?: string }) => void) | null = null;
    let focus:
      | ((event: { tabId: string; sessionId?: string }) => void)
      | null = null;
    platform.embeddedBrowser = {
      onCreateRequested: (listener: (event: { sessionId?: string }) => void) => {
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
    };
    return {
      requestTab: (sessionId?: string) => act(() => create?.({ sessionId })),
      focusTab: (tabId: string, sessionId?: string) =>
        act(() => focus?.({ tabId, sessionId })),
    };
  }

  it("does not open a background task's page in the workbench on screen", () => {
    const adapter = installAdapter();
    render(
      <WorkspacePaneProvider sessionId="session-visible">
        <BrowserProbe />
      </WorkspacePaneProvider>,
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
      "browser",
    );
    expect(screen.getByLabelText("open")).toHaveTextContent("true");
    expect(screen.getByLabelText("all tabs")).toHaveTextContent(
      "session-background,session-visible",
    );
  });

  it("keeps a focus request inside the owning session", () => {
    const adapter = installAdapter();
    const { rerender } = render(
      <WorkspacePaneProvider sessionId="session-visible">
        <BrowserProbe />
      </WorkspacePaneProvider>,
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
        <WorkspacePaneProvider sessionId="session-background">
          <BrowserProbe />
        </WorkspacePaneProvider>,
      );
    });
    expect(screen.getByLabelText("visible tabs")).toHaveTextContent("1");
    expect(screen.getByLabelText("open")).toHaveTextContent("true");
  });
});
