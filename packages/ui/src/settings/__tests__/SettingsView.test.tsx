import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { SettingsPageActions } from "../page-chrome";

vi.mock("../AgentBehaviorEditor", () => ({
  SettingsAssistantBehavior: () => <div>Default behavior</div>,
}));

import { SettingsView } from "../SettingsView";

describe("SettingsView DSH navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/#behavior");
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
              <button type="button" data-testid="dsh-example-navigation">
                Example section
              </button>
            </>
          ),
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Behavior & identity" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Tools" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Skills" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Memory" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Example section" }),
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
          screen.getByTestId("dsh-example-navigation"),
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
    // Agent presets migrated from the built-in registry to the
    // dsh-plugin-agent-preset section ledger — no registry row remains.
    expect(
      screen.queryByRole("button", { name: "Agent presets" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Status" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Connection" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logs" })).toBeVisible();
  });

  it("hands removed compatibility ids to the section ledger instead of a registry page", () => {
    window.history.replaceState(null, "", "/#multi-model-collaboration");
    const seen: Array<string | undefined> = [];
    render(
      <SettingsView
        slots={{
          assistantNavigation: (activeSection) => {
            seen.push(activeSection);
            return null;
          },
        }}
      />,
    );
    // Unknown ids resolve as dsh sections now; a dead id simply has no
    // section claiming it, and no built-in page pretends to own it.
    expect(seen).toContain("multi-model-collaboration");
    expect(
      screen.getByRole("button", { name: "Appearance" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  it("resolves a non-registry id against the DSH section ledger: #models becomes the dsh:models route", () => {
    window.history.replaceState(null, "", "/#models");
    const seen: Array<string | undefined> = [];
    render(
      <SettingsView
        slots={{
          assistantNavigation: (activeSection) => {
            seen.push(activeSection);
            return null;
          },
        }}
      />,
    );
    // No registry page claims the id — the route is handed to the
    // dsh-section surface instead of falling back to Appearance, so plugin
    // sections stay addressable by bare id after a registry page migrates.
    expect(seen).toContain("models");
    expect(
      screen.queryByRole("button", { name: "Models & services" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Appearance" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  it("gates a desktopOnly route off-desktop: #shortcuts falls back to Appearance and Shortcuts is absent from nav", () => {
    setPlatform({
      kind: "web",
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
    } as unknown as PlatformAdapter);
    window.history.replaceState(null, "", "/#shortcuts");
    render(<SettingsView />);
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByRole("button", { name: "Shortcuts" }),
    ).not.toBeInTheDocument();
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
    const appearance = screen.getByRole("button", { name: "Appearance" });
    expect(tools).toHaveAttribute("aria-current", "page");
    expect(appearance).not.toHaveAttribute("aria-current");

    await user.click(appearance);

    expect(appearance).toHaveAttribute("aria-current", "page");
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
    window.history.replaceState(null, "", "/#behavior");
    render(<SettingsView />);
    expect(
      await screen.findByRole("heading", { name: "Behavior & identity" }),
    ).toBeVisible();
  });

  it("resolves the migrated #agents id (with or without a detail segment) against the DSH section ledger", () => {
    window.history.replaceState(null, "", "/#agents/my-preset");
    const seen: Array<string | undefined> = [];
    render(
      <SettingsView
        slots={{
          assistantNavigation: (activeSection) => {
            seen.push(activeSection);
            return null;
          },
        }}
      />,
    );
    // The registry no longer claims "agents" — the route falls through to
    // the dsh-section surface (drill-in state is now internal to the
    // dsh-plugin-agent-preset section), keeping old deep links addressable.
    expect(seen).toContain("agents");
    expect(
      screen.getByRole("button", { name: "Appearance" }),
    ).not.toHaveAttribute("aria-current", "page");
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

  it("portals a DSH section's actions into the scaffold head via owner.actionsHost", async () => {
    window.history.replaceState(null, "", "/#dsh:skills");
    const { container } = render(
      <SettingsView
        dshSections={[{ id: "skills", label: "Skills" }]}
        slots={{
          section: (_sectionId, owner) => (
            <SettingsPageActions host={owner.actionsHost}>
              <button type="button">Act</button>
            </SettingsPageActions>
          ),
        }}
      />,
    );

    await waitFor(() => {
      const host = container.querySelector("[data-settings-page-actions]");
      expect(host).not.toBeNull();
      expect(host).toContainElement(
        screen.getByRole("button", { name: "Act" }),
      );
    });
  });
});
