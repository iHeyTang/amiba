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
    scheduledSessions: [],
    scheduledReady: true,
    onOpenScheduledSession: vi.fn(),
    onRefreshScheduledSessions: vi.fn(),
    scheduledLabelFor: vi.fn((source: string) => source),
    historyLayout: "timeline" as const,
    onHistoryLayoutChange: vi.fn(),
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

  it("keeps chats and scheduled runs together in the timeline layout", async () => {
    const props = setup({
      scheduledSessions: [
        {
          id: "cron_daily_1",
          title: "Jul 22, 11:30",
          createdAt: 2,
          updatedAt: 2,
          messageCount: 1,
          source: "daily",
        },
      ],
      scheduledLabelFor: () => "Daily report",
    })

    expect(screen.getByText("First chat")).toBeInTheDocument()
    await userEvent.click(screen.getByText("Daily report · Jul 22, 11:30"))
    expect(props.onOpenScheduledSession).toHaveBeenCalledWith("cron_daily_1")
  })

  it("renders separate chat and scheduled sections in grouped layout", () => {
    setup({
      historyLayout: "grouped",
      scheduledSessions: [
        {
          id: "cron_daily_1",
          title: "Jul 22, 11:30",
          createdAt: 2,
          updatedAt: 2,
          messageCount: 1,
          source: "daily",
        },
      ],
      scheduledLabelFor: () => "Daily report",
    })

    expect(screen.getByText("Chats")).toBeInTheDocument()
    expect(screen.getAllByText("Scheduled tasks").length).toBeGreaterThan(0)
  })

  it("switches history layout from the header controls", async () => {
    const props = setup()
    await userEvent.click(
      screen.getByRole("button", { name: "Group chats and scheduled tasks" }),
    )
    expect(props.onHistoryLayoutChange).toHaveBeenCalledWith("grouped")
  })

  it("reveals history in batches of twenty with stable copy", async () => {
    setup({
      sessions: Array.from({ length: 45 }, (_, index) => ({
        id: `s${index + 1}`,
        title: `Chat ${index + 1}`,
        createdAt: 45 - index,
        updatedAt: 45 - index,
        messageCount: 1,
      })),
    })

    expect(screen.getByText("Chat 20")).toBeInTheDocument()
    expect(screen.queryByText("Chat 21")).not.toBeInTheDocument()
    const showMore = screen.getByRole("button", { name: "Show more" })

    await userEvent.click(showMore)
    expect(screen.getByText("Chat 40")).toBeInTheDocument()
    expect(screen.queryByText("Chat 41")).not.toBeInTheDocument()

    await userEvent.click(showMore)
    expect(screen.getByText("Chat 45")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument()
  })
})
