import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  sidebarFailedSessionIds: [] as string[],
}));

vi.mock("@amiba/core", () => ({
  useSessions: mocks.useSessions,
}));

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock("@amiba/platform", () => ({
  getPlatform: () => ({
    storage: {
      get: mocks.storageGet,
      set: mocks.storageSet,
      watch: mocks.storageWatch,
    },
  }),
}));

vi.mock("../../theme", () => ({
  useResolvedTheme: () => ({ theme: "light" }),
}));

vi.mock("../Sidebar", () => ({
  Sidebar: ({
    onNewChat,
    onSelectView,
    showCapabilityExtensions,
    runningSessionIds,
    failedSessionIds,
  }: {
    onNewChat: () => void;
    onSelectView: (view: string) => void;
    showCapabilityExtensions?: boolean;
    runningSessionIds?: ReadonlySet<string>;
    failedSessionIds?: ReadonlySet<string>;
  }) => {
    mocks.sidebarRunningSessionIds = Array.from(runningSessionIds ?? []);
    mocks.sidebarFailedSessionIds = Array.from(failedSessionIds ?? []);
    return (
      <>
        <button type="button" onClick={onNewChat}>
          new-chat
        </button>
        <button type="button" onClick={() => onSelectView("scheduled")}>
          scheduled
        </button>
        {showCapabilityExtensions ? (
          <button
            type="button"
            onClick={() => onSelectView("capability-extensions")}
          >
            capability-extensions
          </button>
        ) : null}
      </>
    );
  },
}));

vi.mock("../CommandPalette", () => ({
  CommandPalette: () => null,
}));

vi.mock("../useCommandPalette", () => ({
  useCommandPalette: () => ({ open: false, setOpen: mocks.paletteSetOpen }),
}));

vi.mock("../ScheduledTasksPage", () => ({
  ScheduledTasksPage: ({
    sidebarCollapsed,
    onExpandSidebar,
  }: {
    sidebarCollapsed?: boolean;
    onExpandSidebar?: () => void;
  }) => (
    <div>
      {sidebarCollapsed ? (
        <button type="button" onClick={onExpandSidebar}>
          chat.expandSidebar
        </button>
      ) : null}
      scheduled-page
    </div>
  ),
}));

vi.mock("../internal/useScheduledRuns", () => ({
  useScheduledRuns: () => ({
    runs: [],
    ready: true,
    activeRunTitle: () => null,
    labelFor: () => "",
    refresh: vi.fn(),
  }),
}));

vi.mock("../useSessionTitle", () => ({
  SessionTitleProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useSessionTitle: () => "",
}));

vi.mock("../ChatSurface", () => ({
  default: () => {
    const [draft, setDraft] = useState("");
    return (
      <div>
        <span>chat-surface</span>
        <input
          aria-label="chat-draft"
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
      </div>
    );
  },
}));

vi.mock("@amiba/extension-host/renderer", () => ({
  ExtensionWebView: () => null,
  useExtensionMains: () => [],
}));

vi.mock("../../settings/SettingsCapabilities", () => ({
  SettingsCapabilities: () => <div>capability-extensions-page</div>,
}));

import FullScreenChatView from "../FullScreenChatView";
import { APP_SIDEBAR_DEFAULT_WIDTH } from "../../navigation/sidebar-layout";

function makeSessions() {
  const session = {
    id: "session-1",
    title: "Existing conversation",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 2,
  };
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
  };
}

function makeClient() {
  return {
    onSnapshot: vi.fn((listener) => {
      mocks.snapshotListener = listener;
      return () => {
        if (mocks.snapshotListener === listener) mocks.snapshotListener = null;
      };
    }),
    onStreamEvent: vi.fn((listener) => {
      mocks.streamListener = listener;
      return () => {
        if (mocks.streamListener === listener) mocks.streamListener = null;
      };
    }),
  };
}

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
  });
  return event;
}

function widthTransitionEndEvent(): Event {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "width" });
  return event;
}

describe("FullScreenChatView new-chat home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streamListener = null;
    mocks.snapshotListener = null;
    mocks.sidebarRunningSessionIds = [];
    mocks.sidebarFailedSessionIds = [];
    mocks.storageGet.mockImplementation(async (key: string | string[]) => {
      if (key === "settings.chat.sidebarView") {
        return { [key]: "scheduled" };
      }
      return {};
    });
    mocks.storageSet.mockResolvedValue(undefined);
  });

  it("returns to the id-less home instead of creating a conversation", async () => {
    const sessions = makeSessions();
    mocks.useSessions.mockReturnValue(sessions);

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "new-chat" }));

    expect(sessions.deselect).toHaveBeenCalledOnce();
    expect(sessions.createNew).not.toHaveBeenCalled();
  });

  it("keeps the empty task header visually silent", () => {
    const sessions = makeSessions();
    sessions.activeId = "";
    sessions.openTabIds = [];
    sessions.openTabs = [];
    mocks.useSessions.mockReturnValue(sessions);

    const { container } = render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    expect(
      container.querySelector("[data-content-header-title]"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Amiba")).not.toBeInTheDocument();
  });

  it("edits the active conversation title directly in the content header", async () => {
    const sessions = makeSessions();
    mocks.useSessions.mockReturnValue(sessions);

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    const titleButton = screen.getByRole("button", { name: "chat.rename" });
    expect(titleButton).toHaveClass("cursor-default");
    expect(titleButton).not.toHaveClass("cursor-text");
    await userEvent.click(titleButton);
    const editor = screen.getByRole("textbox", { name: "chat.rename" });
    expect(editor).toHaveValue("Existing conversation");
    expect(editor).toHaveFocus();
    expect((editor as HTMLInputElement).selectionStart).toBe(0);
    expect((editor as HTMLInputElement).selectionEnd).toBe(
      "Existing conversation".length,
    );

    await userEvent.clear(editor);
    await userEvent.type(editor, "Renamed conversation{Enter}");
    expect(sessions.rename).toHaveBeenCalledWith(
      "session-1",
      "Renamed conversation",
    );
    expect(
      screen.queryByRole("textbox", { name: "chat.rename" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "chat.rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "chat.rename" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "chat.rename" }),
      "Cancelled{Escape}",
    );
    expect(sessions.rename).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "chat.rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "chat.rename" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "chat.rename" }),
      "Saved on blur",
    );
    const header = screen
      .getByRole("textbox", { name: "chat.rename" })
      .closest("header");
    expect(header).toHaveClass("app-no-drag");
    fireEvent.pointerDown(header!);
    expect(sessions.rename).toHaveBeenLastCalledWith(
      "session-1",
      "Saved on blur",
    );
    expect(header).not.toHaveClass("app-no-drag");
  });

  it("can ignore the persisted sidebar destination on app startup", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("chat-surface")).toBeInTheDocument();
    });
    expect(screen.getByTestId("chats-view")).toHaveClass("flex");
    expect(screen.getByTestId("scheduled-view")).toHaveClass("hidden");
  });

  it("keeps first-class pages mounted and switches them without a transient layout", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        capabilityExtensions={{}}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    const capabilityPage = screen.getByText("capability-extensions-page");
    const scheduledPage = screen.getByText("scheduled-page");
    const chatSurface = screen.getByText("chat-surface");
    const chatsView = screen.getByTestId("chats-view");
    const capabilityView = screen.getByTestId("capability-extensions-view");
    const scheduledView = screen.getByTestId("scheduled-view");
    expect(chatsView).toHaveClass("flex");
    expect(capabilityView).toHaveClass("hidden");
    expect(scheduledView).toHaveClass("hidden");
    await userEvent.type(screen.getByLabelText("chat-draft"), "keep me");

    await userEvent.click(
      screen.getByRole("button", { name: "capability-extensions" }),
    );
    expect(capabilityView).toHaveClass("flex");
    expect(capabilityView).not.toHaveClass("hidden");
    expect(chatsView).toHaveClass("hidden");
    expect(scheduledView).toHaveClass("hidden");
    expect(screen.getByText("chat-surface")).toBe(chatSurface);

    await userEvent.click(screen.getByRole("button", { name: "scheduled" }));
    expect(scheduledView).toHaveClass("flex");
    expect(scheduledView).not.toHaveClass("hidden");
    expect(chatsView).toHaveClass("hidden");
    expect(capabilityView).toHaveClass("hidden");
    expect(screen.getByText("capability-extensions-page")).toBe(capabilityPage);

    await userEvent.click(screen.getByRole("button", { name: "new-chat" }));
    await waitFor(() => expect(chatsView).toHaveClass("flex"));
    expect(capabilityView).toHaveClass("hidden");
    expect(scheduledView).toHaveClass("hidden");
    expect(screen.getByText("chat-surface")).toBe(chatSurface);
    expect(screen.getByLabelText("chat-draft")).toHaveValue("keep me");
  });

  it("moves search to the sidebar header", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "chat.search" }));
    expect(mocks.paletteSetOpen).toHaveBeenCalledWith(true);
  });

  it("mounts the workbench as a sibling column of the chat column", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        capabilities={{ workspaceInspector: { files: {} } } as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    const chat = screen.getByText("chat-surface");
    const pane = await screen.findByLabelText("workspacePane.title");
    const paneColumn = pane.parentElement;
    const rightContent = paneColumn?.parentElement;
    const edgeToggle = screen.getByRole("button", {
      name: "workspacePane.open",
    });
    const edgeToggleLayer = edgeToggle.parentElement;

    expect(rightContent).toHaveClass("relative", "flex");
    expect(rightContent?.children).toHaveLength(3);
    expect(rightContent?.children[0]).toContainElement(chat);
    expect(rightContent?.children[1]).toBe(paneColumn);
    expect(rightContent?.children[2]).toBe(edgeToggleLayer);
    expect(edgeToggleLayer).toHaveClass("absolute", "right-3", "top-0");
  });

  it("collapses and restores the sidebar from the pane headers", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
        topBarLeftInset={96}
      />,
    );

    const sidebar = screen.getByTestId("main-sidebar");
    const sidebarContent = screen.getByTestId("main-sidebar-content");
    const expandControl = screen.getByTestId("sidebar-expand-control");
    const sidebarIconBox = screen.getByTestId("sidebar-header-icon-box");
    const contentIconBox = screen.getByTestId("content-header-icon-box");
    const contentHeaderLeading = document.querySelector(
      "[data-content-header-leading]",
    );
    const contentHeader = contentHeaderLeading?.parentElement;
    expect(sidebar).toHaveStyle({ width: `${APP_SIDEBAR_DEFAULT_WIDTH}px` });
    expect(sidebar).toHaveClass(
      "transition-[width]",
      "duration-200",
      "ease-out",
    );
    expect(expandControl).toHaveAttribute("aria-hidden", "true");
    expect(expandControl).toHaveAttribute("tabindex", "-1");
    expect(expandControl).toHaveClass("invisible", "pointer-events-none");
    expect(sidebarIconBox).toHaveClass("visible");
    expect(contentIconBox).toHaveClass("visible");
    expect(contentIconBox.querySelectorAll("svg")).toHaveLength(2);
    expect(contentHeader).toHaveStyle({ paddingLeft: "12px" });
    expect(
      screen.getByRole("button", { name: "new-chat" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "chat.collapseSidebar" }),
    );
    expect(
      screen.queryByRole("button", { name: "new-chat" }),
    ).not.toBeInTheDocument();
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(sidebar).toHaveStyle({ width: "0px" });
    expect(contentHeader).toHaveStyle({ paddingLeft: "96px" });
    expect(contentHeaderLeading).toHaveStyle({ left: "96px" });
    expect(sidebar).toHaveClass("transition-[width]", "duration-200");
    expect(sidebarContent).not.toHaveClass("invisible");
    expect(sidebarContent).not.toHaveClass("transition-opacity");
    expect(expandControl).toHaveClass("invisible", "pointer-events-none");
    expect(expandControl).toHaveAttribute("aria-hidden", "true");
    expect(expandControl).toHaveAttribute("tabindex", "-1");
    expect(sidebarIconBox).toHaveClass("invisible", "pointer-events-none");
    expect(sidebarIconBox).toHaveAttribute("inert");
    expect(contentIconBox).toHaveClass("invisible", "pointer-events-none");
    expect(contentIconBox).toHaveAttribute("inert");
    expect(
      screen.queryByRole("button", { name: "chat.collapseSidebar" }),
    ).not.toBeInTheDocument();

    fireEvent(sidebar, widthTransitionEndEvent());
    expect(expandControl).toHaveClass("visible");
    expect(expandControl).not.toHaveClass("invisible", "pointer-events-none");
    expect(expandControl).toHaveAttribute("aria-hidden", "false");
    expect(expandControl).toHaveAttribute("tabindex", "0");
    expect(contentIconBox).toHaveClass("visible");
    expect(contentIconBox).not.toHaveAttribute("inert");

    expect(mocks.storageSet).toHaveBeenCalledWith({
      "settings.chat.sidebarCollapsed": true,
    });

    await userEvent.click(expandControl);
    expect(
      screen.getByRole("button", { name: "new-chat" }),
    ).toBeInTheDocument();
    expect(sidebar).toHaveAttribute("aria-hidden", "false");
    expect(sidebar).toHaveStyle({ width: `${APP_SIDEBAR_DEFAULT_WIDTH}px` });
    expect(expandControl).toHaveClass("invisible", "pointer-events-none");
    expect(sidebarIconBox).toHaveClass("invisible", "pointer-events-none");
    expect(contentIconBox).toHaveClass("invisible", "pointer-events-none");
    expect(
      screen.queryByRole("button", { name: "chat.collapseSidebar" }),
    ).not.toBeInTheDocument();

    fireEvent(sidebar, widthTransitionEndEvent());
    expect(
      screen.getByRole("button", { name: "chat.collapseSidebar" }),
    ).toBeInTheDocument();
    expect(sidebarIconBox).toHaveClass("visible");
    expect(contentIconBox).toHaveClass("visible");
    expect(mocks.storageSet).toHaveBeenCalledWith({
      "settings.chat.sidebarCollapsed": false,
    });
  });

  it("snaps sidebar resizing to the shared default width", () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    const sidebar = screen.getByTestId("main-sidebar");
    const handle = screen.getByTestId("sidebar-resize-handle");
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });

    fireEvent(handle, pointerEvent("pointerdown", 240));
    fireEvent(handle, pointerEvent("pointermove", 260));
    expect(sidebar).toHaveStyle({ width: "260px" });

    fireEvent(handle, pointerEvent("pointermove", 248));
    expect(sidebar).toHaveStyle({ width: "240px" });
    fireEvent(handle, pointerEvent("pointerup", 248));

    expect(mocks.storageSet).toHaveBeenCalledWith({
      "settings.chat.sidebarWidth": APP_SIDEBAR_DEFAULT_WIDTH,
    });
  });

  it("marks a completion unread while another app view is visible", async () => {
    const sessions = makeSessions();
    mocks.useSessions.mockReturnValue(sessions);

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("scheduled-view")).not.toHaveClass("hidden");
    });
    mocks.streamListener?.("session-1", { kind: "done" });
    expect(sessions.markUnread).toHaveBeenCalledWith("session-1");

    mocks.streamListener?.("session-1", { kind: "aborted" });
    expect(sessions.markUnread).toHaveBeenCalledTimes(1);
  });

  it("tracks running sessions from live events and recovered snapshots", () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    act(() => mocks.streamListener?.("session-1", { kind: "begin" }));
    expect(mocks.sidebarRunningSessionIds).toEqual(["session-1"]);
    expect(mocks.sidebarFailedSessionIds).toEqual([]);

    act(() => mocks.streamListener?.("session-1", { kind: "done" }));
    expect(mocks.sidebarRunningSessionIds).toEqual([]);
    expect(mocks.sidebarFailedSessionIds).toEqual([]);

    act(() =>
      mocks.snapshotListener?.({ sessionId: "session-1", kind: "live" }),
    );
    expect(mocks.sidebarRunningSessionIds).toEqual(["session-1"]);
    expect(mocks.sidebarFailedSessionIds).toEqual([]);

    act(() =>
      mocks.snapshotListener?.({
        sessionId: "session-1",
        kind: "interrupted",
      }),
    );
    expect(mocks.sidebarRunningSessionIds).toEqual(["session-1"]);
    expect(mocks.sidebarFailedSessionIds).toEqual(["session-1"]);

    act(() => mocks.streamListener?.("session-1", { kind: "error" }));
    expect(mocks.sidebarRunningSessionIds).toEqual([]);
    expect(mocks.sidebarFailedSessionIds).toEqual(["session-1"]);

    act(() => mocks.streamListener?.("session-1", { kind: "begin" }));
    expect(mocks.sidebarFailedSessionIds).toEqual([]);

    act(() => mocks.streamListener?.("session-1", { kind: "aborted" }));
    expect(mocks.sidebarRunningSessionIds).toEqual([]);
    expect(mocks.sidebarFailedSessionIds).toEqual([]);
  });
});
