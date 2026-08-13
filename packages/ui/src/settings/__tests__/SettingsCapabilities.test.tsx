import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../PluginsTab", () => ({
  PluginsTab: () => <div data-testid="plugins-list">plugins</div>,
}));

vi.mock("../SettingsApplets", async () => {
  const { forwardRef } = await import("react");
  return {
    SettingsApplets: forwardRef(function SettingsAppletsMock(_, _ref) {
      return <div data-testid="applets-list">applets</div>;
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

  it("keeps Applets, plugins, and skills in one main-workspace page", async () => {
    const user = userEvent.setup();
    render(<SettingsCapabilities />);

    expect(screen.getByTestId("applets-list")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByTestId("plugins-list")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skills" }));

    expect(screen.getByTestId("skills-list")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("does not reuse a primary plugin action as the Applet refresh button", async () => {
    const user = userEvent.setup();
    render(
      <AgentTaskProvider value={vi.fn()}>
        <SettingsCapabilities />
      </AgentTaskProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Plugins" }));
    const pluginAction = screen.getByRole("button", { name: "Add" });

    await user.click(screen.getByRole("button", { name: "Applets" }));
    const refreshAction = screen.getByRole("button", { name: "Refresh" });

    expect(refreshAction).not.toBe(pluginAction);
    expect(refreshAction).toHaveClass("bg-transparent");
    expect(refreshAction).not.toHaveClass("bg-primary");
  });
});
