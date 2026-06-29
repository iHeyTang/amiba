import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Sidebar } from "../Sidebar"

function setup(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    activeView: "chats",
    onSelectView: vi.fn(),
    onNewChat: vi.fn(),
    extensionItems: [],
    onOpenCommandPalette: vi.fn(),
    sessions: [
      { id: "s1", title: "First chat", createdAt: 1, updatedAt: 1, messageCount: 1 },
    ],
    activeSessionId: "",
    sessionsReady: true,
    onOpenSession: vi.fn(),
    onRenameSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onRefreshSessions: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  }
  render(<Sidebar {...props} />)
  return props
}

describe("Sidebar", () => {
  it("fires onNewChat from the new-chat row", async () => {
    const props = setup()
    await userEvent.click(screen.getByTestId("sidebar-item-new-chat"))
    expect(props.onNewChat).toHaveBeenCalledTimes(1)
  })

  it("selects a built-in nav view", async () => {
    const props = setup()
    await userEvent.click(screen.getByTestId("sidebar-item-scheduled"))
    expect(props.onSelectView).toHaveBeenCalledWith("scheduled")
  })

  it("selects an extension nav view by its extensionId", async () => {
    const props = setup({
      extensionItems: [
        { extensionId: "village", icon: "book-open", label: "Village", viewUrl: "x", order: 100 },
      ],
    })
    await userEvent.click(screen.getByTestId("sidebar-item-village"))
    expect(props.onSelectView).toHaveBeenCalledWith("village")
  })

  it("opens the command palette from the search row", async () => {
    const props = setup()
    await userEvent.click(screen.getByTestId("sidebar-item-search"))
    expect(props.onOpenCommandPalette).toHaveBeenCalledTimes(1)
  })

  it("opens settings from the footer row", async () => {
    const props = setup()
    await userEvent.click(screen.getByTestId("sidebar-item-settings"))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it("renders the conversation history and opens a row", async () => {
    const props = setup()
    await userEvent.click(screen.getByText("First chat"))
    expect(props.onOpenSession).toHaveBeenCalledWith("s1")
  })
})
