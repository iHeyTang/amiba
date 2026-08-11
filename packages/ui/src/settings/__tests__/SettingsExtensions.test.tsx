import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const extensionHost = vi.hoisted(() => ({
  desktopBridge: vi.fn(),
  useExtensionRegistry: vi.fn(),
}))

vi.mock("@amiba/extension-host/renderer", () => extensionHost)

import { SettingsExtensions } from "../SettingsExtensions"

describe("SettingsExtensions", () => {
  const uninstall = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    uninstall.mockResolvedValue({ ok: true })
    extensionHost.desktopBridge.mockReturnValue({
      extensions: {
        addLocal: vi.fn(),
        onExtensionsChanged: vi.fn(() => () => {}),
        pickFolder: vi.fn(),
        reload: vi.fn(),
        uninstall,
      },
    })
    extensionHost.useExtensionRegistry.mockReturnValue([
      {
        id: "io.amiba.removed",
        source: "local",
        path: "/workspace/amiba-ext-removed",
        disabled: false,
        status: "failed",
        error: "extension directory missing",
      },
    ])
  })

  it("shows and can unlink a registry row whose manifest is unavailable", async () => {
    const user = userEvent.setup()
    render(<SettingsExtensions />)

    expect(screen.getAllByText("io.amiba.removed")).toHaveLength(2)
    expect(screen.getByText("/workspace/amiba-ext-removed")).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("Local")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Uninstall" }))
    expect(
      screen.getByText(
        "Only removes io.amiba.removed from the registry. The source folder at /workspace/amiba-ext-removed is not touched.",
      ),
    ).toBeInTheDocument()

    const uninstallButtons = screen.getAllByRole("button", {
      name: "Uninstall",
    })
    await user.click(uninstallButtons[uninstallButtons.length - 1]!)

    await waitFor(() => {
      expect(uninstall).toHaveBeenCalledWith("io.amiba.removed")
    })
  })
})
