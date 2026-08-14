import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../PluginsTab", () => ({
  PluginsTab: () => <div data-testid="plugins-list">plugins</div>,
}));

vi.mock("../SettingsExtensions", async () => {
  const { forwardRef } = await import("react");
  return {
    SettingsExtensions: forwardRef(function SettingsExtensionsMock(props: {
      onViewChange?: (view: unknown) => void;
      view?: { mode: "use" | "manage" } | null;
    }, _ref) {
      return <div data-testid="extensions-list">
        extensions
        <button
          type="button"
          onClick={() => props.onViewChange?.({
            extensionId: "mortgage",
            name: "Mortgage calculator",
            mode: "use",
          })}
        >
          Open mortgage calculator
        </button>
        <span data-testid="extension-mode">{props.view?.mode ?? "library"}</span>
      </div>;
    }),
  };
});

vi.mock("../../skills", () => ({
  SkillsPage: () => <div data-testid="skills-list">skills</div>,
}));

import { SettingsCapabilities } from "../SettingsCapabilities";
import { AgentTaskProvider } from "../agent-task";

describe("SettingsCapabilities", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("keeps Extensions, plugins, and skills in one main-workspace page", async () => {
    const user = userEvent.setup();
    render(<SettingsCapabilities />);

    expect(screen.getByTestId("extensions-list")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByTestId("plugins-list")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skills" }));

    expect(screen.getByTestId("skills-list")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("does not reuse a primary plugin action as the Extension refresh button", async () => {
    const user = userEvent.setup();
    render(
      <AgentTaskProvider value={vi.fn()}>
        <SettingsCapabilities />
      </AgentTaskProvider>,
    );

    const extensionAddAction = screen.getByRole("button", { name: "Add" });
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Extensions" }));
    const restoredRefreshAction = screen.getByRole("button", { name: "Refresh" });

    expect(restoredRefreshAction).not.toBe(extensionAddAction);
    expect(restoredRefreshAction).toHaveClass("bg-transparent");
    expect(restoredRefreshAction).not.toHaveClass("bg-primary");
  });

  it("replaces the top capability header when an Extension opens", async () => {
    const user = userEvent.setup();
    render(<SettingsCapabilities />);

    await user.click(screen.getByRole("button", { name: "Open mortgage calculator" }));

    expect(screen.queryByRole("button", { name: "Plugins" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mortgage calculator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
    expect(screen.getByTestId("extension-mode")).toHaveTextContent("use");

    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: "Use" })).toBeInTheDocument();
    expect(screen.getByTestId("extension-mode")).toHaveTextContent("manage");

    await user.click(screen.getByRole("button", { name: "Extensions" }));
    expect(screen.getByRole("button", { name: "Plugins" })).toBeInTheDocument();
  });
});
