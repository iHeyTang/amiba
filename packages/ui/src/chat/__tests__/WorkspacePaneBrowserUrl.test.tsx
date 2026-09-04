import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { getPlatform } from "@amiba/app-runtime/platform";

import { WorkspacePaneProvider, useWorkspacePane } from "../WorkspacePane";

const PAGE = "file:///Users/me/report.html";

function Probe() {
  const pane = useWorkspacePane();
  const browserTabs = pane.tabs.filter(
    (tab) => tab.resource.kind === "browser",
  );
  const active = pane.activeTab?.resource;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const opened = pane.openBrowserUrl(PAGE);
          document.title = opened ? "opened" : "refused";
        }}
      >
        open page
      </button>
      <button type="button" onClick={pane.newBrowserTab}>
        new tab
      </button>
      <output aria-label="browser tabs">{browserTabs.length}</output>
      <output aria-label="active url">
        {active?.kind === "browser" ? active.url : ""}
      </output>
      <output aria-label="workspace open">{String(pane.open)}</output>
    </>
  );
}

describe("WorkspacePane openBrowserUrl", () => {
  const platform = getPlatform() as unknown as Record<string, unknown>;
  const previous = platform.embeddedBrowser;

  beforeEach(() => {
    document.title = "";
  });
  afterEach(() => {
    platform.embeddedBrowser = previous;
  });

  it("opens a preset browser tab and reuses it for the same page", async () => {
    platform.embeddedBrowser = {
      onCreateRequested: () => () => {},
      onFocusRequested: () => () => {},
      onAgentActivity: () => () => {},
    };
    render(
      <WorkspacePaneProvider sessionId="session-1">
        <Probe />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "open page" }));
    expect(document.title).toBe("opened");
    expect(screen.getByLabelText("browser tabs")).toHaveTextContent("1");
    expect(screen.getByLabelText("active url")).toHaveTextContent(PAGE);
    expect(screen.getByLabelText("workspace open")).toHaveTextContent("true");

    // A second blank tab, then the same page again: the page tab is
    // re-focused rather than duplicated.
    await userEvent.click(screen.getByRole("button", { name: "new tab" }));
    expect(screen.getByLabelText("browser tabs")).toHaveTextContent("2");
    expect(screen.getByLabelText("active url")).toHaveTextContent(
      "about:blank",
    );
    await userEvent.click(screen.getByRole("button", { name: "open page" }));
    expect(screen.getByLabelText("browser tabs")).toHaveTextContent("2");
    expect(screen.getByLabelText("active url")).toHaveTextContent(PAGE);
  });

  it("refuses when the host has no embedded browser", async () => {
    platform.embeddedBrowser = undefined;
    render(
      <WorkspacePaneProvider sessionId="session-1">
        <Probe />
      </WorkspacePaneProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "open page" }));
    expect(document.title).toBe("refused");
    expect(screen.getByLabelText("browser tabs")).toHaveTextContent("0");
  });
});
