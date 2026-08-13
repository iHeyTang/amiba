import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const extensionHost = vi.hoisted(() => ({
  desktopBridge: vi.fn(),
  useExtensionRegistry: vi.fn(),
}));

vi.mock("@amiba/extension-host/renderer", () => extensionHost);

import { SettingsApplets } from "../SettingsApplets";

describe("SettingsApplets", () => {
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

    render(<SettingsApplets embedded showPageTitle />);

    expect(screen.getByLabelText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No Applets installed")).not.toBeInTheDocument();
  });

  it("keeps a broken registry row visible, inspectable, and removable", async () => {
    const user = userEvent.setup();
    render(<SettingsApplets />);

    expect(screen.getByText("io.amiba.removed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.queryByText("This Applet could not be loaded"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /io\.amiba\.removed/ }),
    );

    expect(
      screen.getByText("/workspace/amiba-ext-removed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This Applet could not be loaded"),
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
});
