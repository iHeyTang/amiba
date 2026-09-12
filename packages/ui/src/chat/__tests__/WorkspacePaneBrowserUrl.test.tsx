import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { WorkbenchExtensionsProvider } from "../workbench-extensions";
import type { WorkbenchViewExtension } from "@amiba/extension-sdk";
const extension: WorkbenchViewExtension = {
  id: "test.preview",
  resourceType: "preview",
  order: 1,
  component: () => null,
  resolveUrl: (url) => ({
    type: "preview",
    id: url,
    title: url,
    data: { url },
  }),
};

import { WorkspacePaneProvider, useWorkspacePane } from "../WorkspacePane";

const PAGE = "file:///Users/me/report.html";

function Probe() {
  const pane = useWorkspacePane();
  const browserTabs = pane.tabs.filter(
    (tab) => tab.resource.kind === "extension",
  );
  const active = pane.activeTab?.resource;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const opened = pane.openUrl(PAGE);
          document.title = opened ? "opened" : "refused";
        }}
      >
        open page
      </button>
      <button
        type="button"
        onClick={() =>
          pane.openResource({
            type: "preview",
            id: "blank",
            title: "Blank",
            data: { url: "about:blank" },
          })
        }
      >
        new tab
      </button>
      <output aria-label="browser tabs">{browserTabs.length}</output>
      <output aria-label="active url">
        {active?.kind === "extension"
          ? (active.resource.data as { url: string }).url
          : ""}
      </output>
      <output aria-label="workspace open">{String(pane.open)}</output>
    </>
  );
}

describe("WorkspacePane URL contributions", () => {
  beforeEach(() => {
    document.title = "";
  });
  it("opens a preset browser tab and reuses it for the same page", async () => {
    render(
      <WorkbenchExtensionsProvider extensions={[extension]}>
        <WorkspacePaneProvider sessionId="session-1">
          <Probe />
        </WorkspacePaneProvider>
      </WorkbenchExtensionsProvider>,
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

  it("declines when no plugin handles URLs", async () => {
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
