import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

vi.mock("../AgentModelConfigTab", () => ({
  AgentModelConfigTab: () => (
    <div data-testid="model-settings-view">models</div>
  ),
}));
vi.mock("../AgentBehaviorEditor", () => ({
  SettingsAssistantBehavior: () => <div>Default behavior</div>,
}));

import { SettingsView } from "../SettingsView";

describe("SettingsView DSH navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/#models");
    setPlatform({
      kind: "desktop",
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
    } as unknown as PlatformAdapter);
  });

  it("exposes DSH-native assistant surfaces and removes cut compatibility panes", async () => {
    const user = userEvent.setup();
    render(
      <SettingsView
        slots={{
          assistantNavigation: () => (
            <>
              <button type="button" data-testid="dsh-tools-navigation">
                Tools
              </button>
              <button type="button" data-testid="dsh-skills-navigation">
                Skills
              </button>
              <button type="button" data-testid="dsh-memory-navigation">
                Memory
              </button>
              <button type="button" data-testid="dsh-messaging-navigation">
                Message channels
              </button>
            </>
          ),
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Models & services" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Tools" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Skills" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Memory" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Message channels" }),
    ).toBeVisible();
    expect(
      screen
        .getByTestId("dsh-skills-navigation")
        .compareDocumentPosition(screen.getByTestId("dsh-memory-navigation")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("dsh-memory-navigation")
        .compareDocumentPosition(
          screen.getByTestId("dsh-messaging-navigation"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Voice" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Multi-model collaboration" }),
    ).not.toBeInTheDocument();

    const advanced = screen.getByRole("button", { name: "Advanced" });
    await user.click(advanced);
    expect(screen.getByRole("button", { name: "Agent presets" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Status" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Connection" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeVisible();
  });

  it("does not preserve hashes for removed compatibility surfaces", () => {
    window.history.replaceState(null, "", "/#multi-model-collaboration");
    render(<SettingsView />);
    expect(screen.queryByTestId("model-settings-view")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps built-in and DSH slot navigation on one selected tab", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/#dsh:tools");

    render(
      <SettingsView
        slots={{
          assistantNavigation: (activeSection) => (
            <button
              aria-current={activeSection === "tools" ? "page" : undefined}
              type="button"
            >
              Tools
            </button>
          ),
          section: (sectionId) => <div>{sectionId}</div>,
        }}
      />,
    );

    const tools = screen.getByRole("button", { name: "Tools" });
    const usage = screen.getByRole("button", { name: "Tokens" });
    expect(tools).toHaveAttribute("aria-current", "page");
    expect(usage).not.toHaveAttribute("aria-current");

    await user.click(usage);

    expect(usage).toHaveAttribute("aria-current", "page");
    expect(tools).not.toHaveAttribute("aria-current");
  });

  it("keeps Home as the first sidebar destination", async () => {
    const user = userEvent.setup();
    const onGoHome = vi.fn();
    render(<SettingsView onGoHome={onGoHome} />);
    await user.click(screen.getByRole("button", { name: "Back to home" }));
    expect(onGoHome).toHaveBeenCalledOnce();
  });

  it("renders the unified head title for the active page", async () => {
    window.history.replaceState(null, "", "/#models");
    render(<SettingsView />);
    expect(
      await screen.findByRole("heading", { name: "Models & services" }),
    ).toBeVisible();
  });

  it("parses two-segment hashes into tab + detail", () => {
    window.history.replaceState(null, "", "/#agents/my-preset");
    render(<SettingsView />);
    expect(
      screen.getByRole("button", { name: "Agent presets" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("titles DSH sections from the ledger", () => {
    window.history.replaceState(null, "", "/#dsh:skills");
    render(
      <SettingsView
        dshSections={[{ id: "skills", label: "Skills" }]}
        slots={{ section: () => <div data-testid="section-content" /> }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Skills" })).toBeVisible();
    expect(screen.getByTestId("section-content")).toBeInTheDocument();
  });
});
