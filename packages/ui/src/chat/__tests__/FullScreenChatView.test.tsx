import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  useSessions: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageWatch: vi.fn(() => () => {}),
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
  Sidebar: ({ onNewChat }: { onNewChat: () => void }) => (
    <button type="button" onClick={onNewChat}>
      new-chat
    </button>
  ),
}))

vi.mock("../CommandPalette", () => ({
  CommandPalette: () => null,
}))

vi.mock("../useCommandPalette", () => ({
  useCommandPalette: () => ({ open: false, setOpen: vi.fn() }),
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
    remove: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  }
}

describe("FullScreenChatView new-chat home", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        client={{} as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
      />,
    )

    await userEvent.click(screen.getByRole("button", { name: "new-chat" }))

    expect(sessions.deselect).toHaveBeenCalledOnce()
    expect(sessions.createNew).not.toHaveBeenCalled()
  })

  it("can ignore the persisted sidebar destination on app startup", async () => {
    mocks.useSessions.mockReturnValue(makeSessions())

    render(
      <FullScreenChatView
        client={{} as never}
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
})
