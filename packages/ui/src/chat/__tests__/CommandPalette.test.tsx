import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CommandPalette } from "../CommandPalette"

function setup(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    sessions: [
      { id: "s1", title: "Alpha chat", createdAt: 1, updatedAt: 2 },
      { id: "s2", title: "Beta chat", createdAt: 1, updatedAt: 1 },
    ],
    onOpenSession: vi.fn(),
    onNewChat: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
  render(<CommandPalette {...props} />)
  return props
}

describe("CommandPalette", () => {
  it("shows the search input when open", () => {
    setup()
    expect(screen.getByTestId("command-palette-input")).toBeInTheDocument()
  })

  it("runs New Chat and closes", async () => {
    const props = setup()
    await userEvent.click(screen.getByText("New Chat"))
    expect(props.onNewChat).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("runs Settings and closes", async () => {
    const props = setup()
    await userEvent.click(screen.getByText("Settings"))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("lists chats and opens the picked one", async () => {
    const props = setup()
    await userEvent.click(screen.getByText("Alpha chat"))
    expect(props.onOpenSession).toHaveBeenCalledWith("s1")
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it("filters chats by the typed query", async () => {
    setup()
    await userEvent.type(screen.getByTestId("command-palette-input"), "Beta")
    expect(screen.getByText("Beta chat")).toBeInTheDocument()
    expect(screen.queryByText("Alpha chat")).not.toBeInTheDocument()
  })

  it("renders nothing when closed", () => {
    setup({ open: false })
    expect(screen.queryByTestId("command-palette-input")).not.toBeInTheDocument()
  })
})
