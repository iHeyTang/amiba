import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  useSessions: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageWatch: vi.fn(() => () => {}),
  paletteSetOpen: vi.fn(),
  streamListener: null as
    | ((sessionId: string, event: { kind: string }) => void)
    | null,
  snapshotListener: null as
    | ((frame: { sessionId: string; kind: string }) => void)
    | null,
  sidebarRunningSessionIds: [] as string[],
}))

vi.mock("@amiba/core", () => ({
  useSessions: mocks.useSessions,
}))

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}))

vi.mock("@amiba/platform", () => ({
  getPlatform: () => ({
    storage: {
      get: mocks.storageGet,
      set: mocks.storageSet,
      watch: mocks.storageWatch,
    },
  }),
}))

vi.mock("../../theme", () => ({
  useResolvedTheme: () => ({ theme: "light" }),
}))

vi.mock("../Sidebar", () => ({
  Sidebar: ({
    onNewChat,
    runningSessionIds,
  }: {
    onNewChat: () => void
    runningSessionIds?: ReadonlySet<string>
  }) => {
    mocks.sidebarRunningSessionIds = Array.from(runningSessionIds ?? [])
    return (
      <button type="button" onClick={onNewChat}>
        new-chat
      </button>
    )
  },
}))

vi.mock("../CommandPalette", () => ({
  CommandPalette: () => null,
}))

vi.mock("../useCommandPalette", () => ({
  useCommandPalette: () => ({ open: false, setOpen: mocks.paletteSetOpen }),
}))

vi.mock("../ScheduledTasksPage", () => ({
  ScheduledTasksPage: () => <div>scheduled-page</div>,
}))

vi.mock("../internal/useScheduledRuns", () => ({
  useScheduledRuns: () => ({
    runs: [],
    ready: true,
    activeRunTitle: () => null,
    labelFor: () => "",
    refresh: vi.fn(),
  }),
}))

vi.mock("../useSessionTitle", () => ({
  SessionTitleProvider: ({ children }: { children: React.ReactNode }) => children,
  useSessionTitle: () => "",
}))

vi.mock("../ChatSurface", () => ({
  default: () => <div>chat-surface</div>,
}))

vi.mock("@amiba/extension-host/renderer", () => ({
  ExtensionWebView: () => null,
  useExtensionMains: () => [],
}))

import FullScreenChatView from "../FullScreenChatView"

function makeSessions() {
  const session = {
    id: "session-1",
    title: "Existing conversation",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 2,
  }
  return {
    ready: true,
    sessions: [session],
    openTabIds: [session.id],
    openTabs: [session],
    activeId: session.id,
    activeMessages: [],
    deselect: vi.fn(async () => {}),
    createNew: vi.fn(async () => "new-session"),
    openTab: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    markUnread: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  }
}

function makeClient() {
  return {
    onSnapshot: vi.fn((listener) => {
      mocks.snapshotListener = listener
      return () => {
        if (mocks.snapshotListener === listener) mocks.snapshotListener = null
      }
    }),
    onStreamEvent: vi.fn((listener) => {
      mocks.streamListener = listener
      return () => {
        if (mocks.streamListener === listener) mocks.streamListener = null
      }
    }),
  }
}

describe("FullScreenChatView new-chat home", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.streamListener = null
    mocks.snapshotListener = null
    mocks.sidebarRunningSessionIds = []
    mocks.storageGet.mockImplementation(async (key: string | string[]) => {
      if (key === "settings.chat.sidebarView") {
        return { [key]: "scheduled" }
      }
      return {}
    })
    mocks.storageSet.mockResolvedValue(undefined)
  })

  it("returns to the id-less home instead of creating a conversation", async () => {
    const sessions = makeSessions()
    mocks.useSessions.mockReturnValue(sessions)

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
      />,
    )

    await userEvent.click(screen.getByRole("button", { name: "new-chat" }))

    expect(sessions.deselect).toHaveBeenCalledOnce()
    expect(sessions.createNew).not.toHaveBeenCalled()
  })

  it("keeps the empty task header visually silent", () => {
    const sessions = makeSessions()
    sessions.activeId = ""
    sessions.openTabIds = []
    sessions.openTabs = []
    mocks.useSessions.mockReturnValue(sessions)

    const { container } = render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    )

    expect(
      container.querySelector("[data-content-header-title]"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Amiba")).not.toBeInTheDocument()
  })

  it("can ignore the persisted sidebar destination on app startup", async () => {
    mocks.useSessions.mockReturnValue(makeSessions())

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText("chat-surface")).toBeInTheDocument()
    })
    expect(screen.queryByText("scheduled-page")).not.toBeInTheDocument()
  })

  it("moves search to the sidebar header", async () => {
    mocks.useSessions.mockReturnValue(makeSessions())

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
      />,
    )

    await userEvent.click(
      screen.getByRole("button", { name: "chat.search" }),
    )
    expect(mocks.paletteSetOpen).toHaveBeenCalledWith(true)
  })

  it("mounts the workbench as a sibling column of the chat column", async () => {
    mocks.useSessions.mockReturnValue(makeSessions())

    render(
      <FullScreenChatView
        client={makeClient() as never}
        capabilities={{ workspaceInspector: { files: {} } } as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    )

    const chat = screen.getByText("chat-surface")
    const pane = await screen.findByLabelText("workspacePane.title")
    const paneColumn = pane.parentElement
    const rightContent = paneColumn?.parentElement
    const edgeToggle = screen.getByRole("button", {
      name: "workspacePane.open",
    })
    const edgeToggleLayer = edgeToggle.parentElement

    expect(rightContent).toHaveClass("relative", "flex")
    expect(rightContent?.children).toHaveLength(3)
    expect(rightContent?.children[0]).toContainElement(chat)
    expect(rightContent?.children[1]).toBe(paneColumn)
    expect(rightContent?.children[2]).toBe(edgeToggleLayer)
    expect(edgeToggleLayer).toHaveClass("absolute", "right-3", "top-0")
  })

  it("collapses and restores the sidebar from the pane headers", async () => {
    mocks.useSessions.mockReturnValue(makeSessions())

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
      />,
    )

    expect(screen.getByRole("button", { name: "new-chat" })).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "chat.collapseSidebar" }),
    )
    expect(
      screen.queryByRole("button", { name: "new-chat" }),
    ).not.toBeInTheDocument()
    expect(mocks.storageSet).toHaveBeenCalledWith({
      "settings.chat.sidebarCollapsed": true,
    })

    await userEvent.click(
      screen.getByRole("button", { name: "chat.expandSidebar" }),
    )
    expect(screen.getByRole("button", { name: "new-chat" })).toBeInTheDocument()
    expect(mocks.storageSet).toHaveBeenCalledWith({
      "settings.chat.sidebarCollapsed": false,
    })
  })

  it("marks a completion unread while another app view is visible", async () => {
    const sessions = makeSessions()
    mocks.useSessions.mockReturnValue(sessions)

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
      />,
    )

    await screen.findByText("scheduled-page")
    mocks.streamListener?.("session-1", { kind: "done" })
    expect(sessions.markUnread).toHaveBeenCalledWith("session-1")

    mocks.streamListener?.("session-1", { kind: "aborted" })
    expect(sessions.markUnread).toHaveBeenCalledTimes(1)
  })

  it("tracks running sessions from live events and recovered snapshots", () => {
    mocks.useSessions.mockReturnValue(makeSessions())

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    )

    act(() => mocks.streamListener?.("session-1", { kind: "begin" }))
    expect(mocks.sidebarRunningSessionIds).toEqual(["session-1"])

    act(() => mocks.streamListener?.("session-1", { kind: "done" }))
    expect(mocks.sidebarRunningSessionIds).toEqual([])

    act(() =>
      mocks.snapshotListener?.({ sessionId: "session-1", kind: "live" }),
    )
    expect(mocks.sidebarRunningSessionIds).toEqual(["session-1"])

    act(() =>
      mocks.snapshotListener?.({
        sessionId: "session-1",
        kind: "interrupted",
      }),
    )
    expect(mocks.sidebarRunningSessionIds).toEqual([])
  })
})
