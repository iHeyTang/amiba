import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const extensionHost = vi.hoisted(() => ({
  desktopBridge: vi.fn(),
  useExtensionRegistry: vi.fn(),
}));

vi.mock("@amiba/extension-host/renderer", () => extensionHost);

import { SettingsExtensions } from "../SettingsExtensions";
import { AgentTaskProvider } from "../agent-task";

describe("SettingsExtensions", () => {
  const uninstall = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    uninstall.mockResolvedValue({ ok: true });
    extensionHost.desktopBridge.mockReturnValue({
      extensions: {
        addLocal: vi.fn(),
        onExtensionsChanged: vi.fn(() => () => {}),
        pickFolder: vi.fn(),
        reload: vi.fn(),
        uninstall,
      },
    });
    extensionHost.useExtensionRegistry.mockReturnValue({
      items: [
        {
          id: "io.amiba.removed",
          source: "local",
          path: "/workspace/amiba-ext-removed",
          disabled: false,
          status: "failed",
          error: "extension directory missing",
        },
      ],
      ready: true,
    });
  });

  it("does not present an unresolved registry as an empty library", () => {
    extensionHost.useExtensionRegistry.mockReturnValue({
      items: [],
      ready: false,
    });

    render(<SettingsExtensions embedded showPageTitle />);

    expect(screen.getByLabelText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No Extensions installed")).not.toBeInTheDocument();
  });

  it("keeps a broken registry row visible, inspectable, and removable", async () => {
    const user = userEvent.setup();
    render(<SettingsExtensions />);

    expect(screen.getByText("io.amiba.removed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.queryByText("This Extension could not be loaded"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /io\.amiba\.removed/ }),
    );

    expect(
      screen.getByText("/workspace/amiba-ext-removed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This Extension could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveClass("border-y");
    expect(
      screen.queryByRole("heading", { name: "Installation" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByText("Capability signature")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      screen.getByText(
        "Only removes io.amiba.removed from the registry. The source folder at /workspace/amiba-ext-removed is not touched.",
      ),
    ).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[removeButtons.length - 1]!);

    await waitFor(() => {
      expect(uninstall).toHaveBeenCalledWith("io.amiba.removed");
    });
  });

  it("turns the pane header into Extension chrome and gives the body to the Extension", async () => {
    const user = userEvent.setup();
    extensionHost.useExtensionRegistry.mockReturnValue({ items: [], ready: true });
    const managedExtensions = {
      list: vi.fn().mockResolvedValue([{
        id: "io.amiba.personal.mortgage-calculator",
        name: "Mortgage calculator",
        description: "Calculate mortgage payments",
        kind: "interactive-ui",
        source: "personal-managed",
        tags: [],
        sourceSessionIds: [],
        pinned: false,
        archived: false,
        userStatus: "ready",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      }]),
      listOutputs: vi.fn().mockResolvedValue([]),
      onChanged: vi.fn(() => () => {}),
    };

    render(
      <AgentTaskProvider managedExtensions={managedExtensions as never}>
        <SettingsExtensions />
      </AgentTaskProvider>,
    );

    const appName = await screen.findByText("Mortgage calculator");
    await user.click(appName.closest("button")!);

    expect(screen.getByRole("heading", { name: "Mortgage calculator" })).toBeInTheDocument();
    expect(screen.getAllByText("Mortgage calculator")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
    expect(screen.queryByText("Calculate mortgage payments")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("button", { name: "Use" })).toBeInTheDocument();
    expect(screen.getByText("Calculate mortgage payments")).toBeInTheDocument();
  });
});
