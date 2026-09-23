import { useNewChatWorkspace } from "../new-chat-workspace";
import { WorkspacePane, WorkspacePaneToggle } from "../WorkspacePane";
import { createTerminalView } from "../../../../../plugins/dsh-plugin-terminal/src/client/index";
import { createBrowserView } from "../../../../../plugins/dsh-plugin-browser-provider-electron/src/client/index";
import { WorkbenchExtensionsProvider } from "../workbench-extensions";
import {
  act,
  fireEvent,
  render as renderTesting,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shells = [{ id: "workbench", order: 100, component: WorkspacePane, toggle: () => <WorkspacePaneToggle showUnavailable /> }];
function render(node: React.ReactNode) { return renderTesting(node, { wrapper: ({ children }) => <WorkbenchExtensionsProvider extensions={[]} shells={shells}>{children}</WorkbenchExtensionsProvider> }); }

const mocks = vi.hoisted(() => ({
  useSessions: vi.fn(),
  loadHistory: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageWatch: vi.fn(
    (
      _keys: readonly string[],
      _listener: (changes: Record<string, { newValue?: unknown }>) => void,
    ) => () => {},
  ),
  storageListeners: [] as Array<{
    keys: readonly string[];
    listener: (changes: Record<string, { newValue?: unknown }>) => void;
  }>,
  paletteSetOpen: vi.fn(),
  streamListener: null as
    | ((sessionId: string, event: { kind: string }) => void)
    | null,
  snapshotListener: null as
    | ((frame: { sessionId: string; kind: string }) => void)
    | null,
  sidebarActiveSessionId: "",
  sidebarRunningSessionIds: [] as string[],
  sidebarFailedSessionIds: [] as string[],
  embeddedBrowser: null as null | Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@amiba/app-runtime/core", () => ({
  useSessions: mocks.useSessions,
}));

vi.mock("../../../../app-runtime/src/core/sessions-runtime/store", () => ({
  loadIndex: async () => [{ id: "session-1", title: "启动项目", createdAt: 1, updatedAt: 1, messageCount: 1 }],
  loadMessages: mocks.loadHistory,
  saveMessages: async () => {},
  saveIndex: async () => {},
}));

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock("@amiba/i18n/plugin", () => ({
  usePluginT: () => ({ t: (key: string) => key }),
}));

vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({
    storage: {
      get: mocks.storageGet,
      set: mocks.storageSet,
      watch: mocks.storageWatch,
    },
    embeddedBrowser: mocks.embeddedBrowser,
    shell: { openExternal: vi.fn() },
  }),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    hasSelection() {
      return false;
    }
    getSelection() {
      return "";
    }
    reset() {}
    write() {}
    focus() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("../../theme", () => ({
  useResolvedTheme: () => ({ theme: "light" }),
  useDocumentTheme: () => "light",
}));

vi.mock("../Sidebar", () => ({
  Sidebar: ({
    activeSessionId,
    onNewChat,
    onNewWorkspaceChat,
    onOpenSession,
    runningSessionIds,
    failedSessionIds,
  }: {
    activeSessionId: string;
    onNewChat: () => void;
    onNewWorkspaceChat: (path: string) => void;
    onOpenSession: (id: string) => void;
    runningSessionIds?: ReadonlySet<string>;
    failedSessionIds?: ReadonlySet<string>;
  }) => {
    mocks.sidebarActiveSessionId = activeSessionId;
    mocks.sidebarRunningSessionIds = Array.from(runningSessionIds ?? []);
    mocks.sidebarFailedSessionIds = Array.from(failedSessionIds ?? []);
    return (
      <>
        <button type="button" onClick={onNewChat}>
          new-chat
        </button>
        <button onClick={() => onNewWorkspaceChat("/work/project")}>workspace-new-chat</button>
        <button onClick={() => onOpenSession("session-1")}>open-session</button>
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

vi.mock("../useSessionTitle", () => ({
  SessionTitleProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useSessionTitle: () => "",
}));

vi.mock("../ChatSurface", () => ({
  default: () => {
    const [draft, setDraft] = useState("");
    const workspace = useNewChatWorkspace();
    return (
      <div>
        <span>chat-surface</span>
        <output aria-label="draft-workspace">{workspace?.path ?? "default"}</output>
        <input
          aria-label="chat-draft"
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
      </div>
    );
  },
}));

import { SessionsProvider, useSessions as useRealSessions } from "../../../../app-runtime/src/core/sessions-runtime/provider";
import { SessionsStore } from "../../../../app-runtime/src/core/sessions-runtime/sessions-store";

import FullScreenChatView from "../FullScreenChatView";
import { APP_SIDEBAR_DEFAULT_WIDTH } from "../../navigation/sidebar-layout";

function makeSessions() {
  const session: {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    agent?: { profileId?: string };
  } = {
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
    markRead: vi.fn(async () => {}),
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
    mocks.storageListeners = [];
    mocks.embeddedBrowser = null;
    mocks.storageGet.mockImplementation(async (key: string | string[]) => {
      if (key === "settings.chat.sidebarView") {
        return { [key]: "scheduled" };
      }
      return {};
    });
    mocks.storageSet.mockResolvedValue(undefined);
    mocks.storageWatch.mockImplementation(
      (
        keys: readonly string[],
        listener: (changes: Record<string, { newValue?: unknown }>) => void,
      ) => {
        const item = { keys, listener };
        mocks.storageListeners.push(item);
        return () => {
          mocks.storageListeners = mocks.storageListeners.filter(
            (candidate) => candidate !== item,
          );
        };
      },
    );
  });

  it.each(["main-panel", "workspace", "conversation"])(
    "opens the active session from %s and only toggles a visible conversation",
    async (surface) => {
      const sessions = makeSessions();
      mocks.useSessions.mockReturnValue(sessions);
      const navigate = vi.fn();
      const navigationSeat = vi.fn(() => null);
      function View() {
        const [panel, setPanel] = useState(surface === "main-panel");
        return <FullScreenChatView
          client={makeClient() as never}
          openSettings={() => {}}
          openAgentDestination={() => {}}
          restoreSidebarViewOnMount={surface === "workspace"}
          slots={{
            mainPanel: panel ? { id: "memory", content: <div>memory-page</div> } : undefined,
            workspaceView: () => <div>workspace-page</div>,
            workspaceNavigation: navigationSeat,
            onNativeNavigation: () => { navigate(); setPanel(false); },
          }}
        />;
      }
      render(<View />);
      await act(async () => {});
      expect(mocks.sidebarActiveSessionId).toBe(surface === "conversation" ? "session-1" : "");
      expect(navigationSeat).toHaveBeenLastCalledWith(surface === "main-panel" ? "" : surface === "workspace" ? "scheduled" : "chats", mocks.sidebarActiveSessionId);
      await userEvent.click(screen.getByRole("button", { name: "open-session" }));
      if (surface === "conversation") {
        expect(sessions.deselect).toHaveBeenCalledOnce();
        expect(sessions.openTab).not.toHaveBeenCalled();
      } else {
        expect(sessions.deselect).not.toHaveBeenCalled();
        expect(sessions.openTab).toHaveBeenCalledWith("session-1");
        expect(navigate).toHaveBeenCalled();
        expect(screen.queryByText("memory-page")).not.toBeInTheDocument();
        expect(screen.getByTestId("chats-view")).not.toHaveClass("hidden");
      }
    },
  );

  it("shows the failed destination with retry and home actions instead of the previous chat", async () => {
    const sessions = { ...makeSessions(), sessionLoad: { sessionId: "session-1", status: "error" as const, message: "unsupported historical event" } };
    sessions.openTab.mockRejectedValue(new Error("unsupported historical event"));
    mocks.useSessions.mockReturnValue(sessions);
    render(<FullScreenChatView client={makeClient() as never} openSettings={() => {}} openAgentDestination={() => {}} restoreSidebarViewOnMount={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("unsupported historical event");
    expect(screen.queryByText("chat-surface")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry|重试/ }));
    expect(sessions.openTab).toHaveBeenCalledWith("session-1");
    expect(sessions.deselect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /New task|返回新任务/ }));
    expect(sessions.deselect).toHaveBeenCalledOnce();
  });

  it("routes a real store failure through the Provider from memory to fallback and retries", async () => {
    const store = new SessionsStore();
    await store.initialize();
    mocks.loadHistory.mockRejectedValueOnce(new Error('format v0 contains unknown historical event type "amiba/notice"'));
    mocks.loadHistory.mockResolvedValue([]);
    mocks.useSessions.mockImplementation(useRealSessions);
    function View() {
      const [panel, setPanel] = useState(true);
      return <SessionsProvider store={store}><FullScreenChatView
        client={makeClient() as never} openSettings={() => {}} openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
        slots={{ mainPanel: panel ? { id: "memory", content: <div>memory-page</div> } : undefined,
          onNativeNavigation: () => setPanel(false) }}
      /></SessionsProvider>;
    }
    render(<View />);
    expect(mocks.sidebarActiveSessionId).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "open-session" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("amiba/notice");
    expect(screen.queryByText("memory-page")).not.toBeInTheDocument();
    expect(mocks.sidebarActiveSessionId).toBe("session-1");
    await userEvent.click(screen.getByRole("button", { name: /Retry|重试/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("chat-surface")).toBeInTheDocument();
    expect(store.getSnapshot().activeId).toBe("session-1");
    expect(mocks.loadHistory).toHaveBeenCalledTimes(2);
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

  it("selects a workspace for a new draft and resets it from the top new-task action", async () => {
    const sessions = makeSessions();
    mocks.useSessions.mockReturnValue(sessions);
    render(<FullScreenChatView client={makeClient() as never} openSettings={() => {}} openAgentDestination={() => {}} restoreSidebarViewOnMount={false} />);
    await userEvent.click(screen.getByRole("button", { name: "workspace-new-chat" }));
    expect(screen.getByLabelText("draft-workspace")).toHaveTextContent("/work/project");
    expect(sessions.deselect).toHaveBeenCalledOnce();
    expect(sessions.createNew).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "new-chat" }));
    expect(screen.getByLabelText("draft-workspace")).toHaveTextContent("default");
    expect(sessions.createNew).not.toHaveBeenCalled();
  });

  it("shows no workbench at all on the id-less home, even when it was left open", async () => {
    const sessions = makeSessions();
    sessions.activeId = "";
    sessions.openTabIds = [];
    sessions.openTabs = [];
    mocks.useSessions.mockReturnValue(sessions);
    mocks.embeddedBrowser = {
      registerTab: vi.fn().mockResolvedValue({}),
      unregisterTab: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn().mockResolvedValue({}),
      command: vi.fn().mockResolvedValue({}),
      detectDevServers: vi.fn().mockResolvedValue([]),
      onCreateRequested: vi.fn(() => () => {}),
      onFocusRequested: vi.fn(() => () => {}),
      onAgentActivity: vi.fn(() => () => {}),
    };
    mocks.storageGet.mockImplementation(async (key: string | string[]) => {
      if (key === "settings.chat.sidebarView") return { [key]: "chats" };
      return {};
    });

    const { container } = render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );
    await act(async () => {});

    expect(
      container.querySelector("[data-workspace-tabbar]"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("complementary", { name: "workspacePane.title" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the empty task header visually silent", () => {
    const sessions = makeSessions();
    sessions.activeId = "";
    sessions.openTabIds = [];
    sessions.openTabs = [];
    mocks.useSessions.mockReturnValue(sessions);
    mocks.embeddedBrowser = {
      registerTab: vi.fn().mockResolvedValue({}),
      unregisterTab: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn().mockResolvedValue({}),
      command: vi.fn().mockResolvedValue({}),
      detectDevServers: vi.fn().mockResolvedValue([]),
      onCreateRequested: vi.fn(() => () => {}),
      onFocusRequested: vi.fn(() => () => {}),
      onAgentActivity: vi.fn(() => () => {}),
    };

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
    // The workbench acts on a task. With no task open there is nothing for the
    // edge controls to target, so the whole row stays off the chat home.
    expect(
      container.querySelector("[data-workspace-edge-toggle]"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "embeddedBrowser.open" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "workspacePane.openTerminal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "workspacePane.open" }),
    ).not.toBeInTheDocument();
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

  it("renders a runtime-owned session's title as plain text, not an editable control", async () => {
    const sessions = makeSessions();
    sessions.sessions = [
      { ...sessions.sessions[0], agent: { profileId: "steward" } },
    ];
    mocks.useSessions.mockReturnValue(sessions);

    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
        hiddenSessionIds={new Set(["session-1"])}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "chat.rename" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Existing conversation")).toBeInTheDocument();
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
    expect(screen.getByTestId("plugin-workspace-view")).toHaveClass("hidden");
  });

  it("keeps chat mounted while a DSH workspace contribution becomes active", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());

    render(
      <FullScreenChatView
        client={makeClient() as never}
        slots={{ workspaceView: () => <div>scheduled-page</div> }}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );

    const scheduledPage = screen.getByText("scheduled-page");
    const chatSurface = screen.getByText("chat-surface");
    const chatsView = screen.getByTestId("chats-view");
    const scheduledView = screen.getByTestId("plugin-workspace-view");
    expect(chatsView).toHaveClass("flex");
    expect(scheduledView).toHaveClass("hidden");
    await userEvent.type(screen.getByLabelText("chat-draft"), "keep me");

    act(() => {
      for (const item of mocks.storageListeners) {
        if (item.keys.includes("settings.chat.sidebarView")) {
          item.listener({
            "settings.chat.sidebarView": { newValue: "scheduled" },
          });
        }
      }
    });
    expect(scheduledView).toHaveClass("flex");
    expect(scheduledView).not.toHaveClass("hidden");
    expect(chatsView).toHaveClass("hidden");
    expect(screen.getByText("scheduled-page")).toBe(scheduledPage);

    await userEvent.click(screen.getByRole("button", { name: "new-chat" }));
    await waitFor(() => expect(chatsView).toHaveClass("flex"));
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

  it("mounts the workbench beside chat in the main content row", async () => {
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
    const mainRow = paneColumn?.parentElement;
    const rightContent = mainRow?.parentElement;
    const edgeToggle = screen.getByRole("button", {
      name: "workspacePane.open",
    });
    const edgeToggleLayer = edgeToggle.parentElement;

    expect(mainRow).toHaveAttribute("data-workspace-main-row");
    expect(mainRow).toHaveClass("relative", "flex", "overflow-hidden");
    expect(mainRow?.children[0]).toContainElement(chat);
    expect(mainRow?.children[1]).toBe(paneColumn);
    expect(rightContent).toHaveClass("relative", "flex", "flex-col");
    expect(rightContent?.children[0]).toBe(mainRow);
    expect(rightContent?.children[1]).toBe(edgeToggleLayer);
    expect(edgeToggleLayer).toHaveClass("absolute", "right-3", "top-0");
  });

  it("opens browser pages as workbench tabs and keeps every workspace control visible", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());
    let requestBrowserTab:
      | ((event: { sessionId?: string }) => void)
      | null = null;
    mocks.embeddedBrowser = {
      registerTab: vi.fn().mockResolvedValue({}),
      unregisterTab: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn().mockResolvedValue({}),
      command: vi.fn().mockResolvedValue({}),
      detectDevServers: vi.fn().mockResolvedValue([]),
      onCreateRequested: vi.fn((listener: (event: { sessionId?: string }) => void) => {
        requestBrowserTab = listener;
        return () => {};
      }),
      onFocusRequested: vi.fn(() => () => {}),
      onAgentActivity: vi.fn(() => () => {}),
    };
    const development = {
      listCheckpoints: vi.fn().mockResolvedValue([]),
      terminalList: vi.fn().mockResolvedValue([]),
      onTerminalData: vi.fn(() => () => {}),
    };

    render(
      <WorkbenchExtensionsProvider shells={shells} extensions={[createBrowserView(mocks.embeddedBrowser as never)]}>
      <FullScreenChatView
        client={makeClient() as never}
        capabilities={
          {
            workspaceInspector: { files: {}, development },
          } as never
        }
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />
      </WorkbenchExtensionsProvider>,
    );

    const workbenchToggle = screen.getByRole("button", { name: "workspacePane.open" });
    expect(workbenchToggle.parentElement?.children).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "workspacePane.openTerminal" })).toBeNull();
    act(() => requestBrowserTab?.({}));
    // Agent-driven browser activity must NOT auto-expand the workbench: the
    // tab is recorded (and lights the pinned-summary badge) without opening.
    expect(
      screen.queryByRole("button", { name: "workspacePane.collapse" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "workspacePane.open" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull();

    // Opening the workbench reveals the recorded browser tab.
    await userEvent.click(
      screen.getByRole("button", { name: "workspacePane.open" }),
    );
    expect(
      document.querySelector("[data-embedded-browser-pane]"),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-embedded-browser-workspace]"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "New tab" }),
    ).toBeInTheDocument();
    expect(screen.getByText("embeddedBrowser.emptyTitle")).toBeInTheDocument();

    // The edge-control row floats over the tab strip at z-50. The strip must
    // reserve the row's MEASURED width — a fixed padding drifts every time a
    // control is added, and `conversation.session.header.utilities` is an open
    // plugin seat, so the width is not knowable here at all.
    const edgeRow = document.querySelector<HTMLElement>(
      "[data-workspace-edge-toggle]",
    );
    const tabBar = document.querySelector<HTMLElement>(
      "[data-workspace-tabbar]",
    );
    expect(edgeRow).not.toBeNull();
    expect(tabBar).not.toBeNull();
    expect(tabBar?.className).not.toMatch(/\bpr-\d/);
    expect(tabBar?.style.paddingRight).toBe(
      "var(--amiba-workbench-controls-inset, 2.75rem)",
    );
    const section = edgeRow?.parentElement;
    const inset = Number.parseInt(
      section?.style.getPropertyValue("--amiba-workbench-controls-inset") ?? "",
      10,
    );
    // jsdom reports zero-width boxes, so this pins the wiring and the gutter
    // rather than a pixel count the layout engine would supply.
    expect(Number.isNaN(inset)).toBe(false);
    expect(inset).toBeGreaterThanOrEqual(20);

    // Electron boolean attributes are presence-valued: `allowpopups="false"`
    // ENABLES popups, and only `will-attach-webview` saves `nodeintegration`.
    // Absence is the only way to say false, so pin absence.
    const webview = document.querySelector("webview");
    expect(webview).not.toBeNull();
    expect(webview?.hasAttribute("nodeintegration")).toBe(false);
    expect(webview?.hasAttribute("allowpopups")).toBe(false);
    // Not <webview> attributes at all; the guest's prefs are enforced in main.
    expect(webview?.hasAttribute("sandbox")).toBe(false);
    expect(webview?.hasAttribute("contextIsolation")).toBe(false);
    expect(webview?.getAttribute("partition")).toBe("persist:amiba-browser");

    await userEvent.click(screen.getByRole("button", { name: "workspacePane.collapse" }));
    await userEvent.click(screen.getByRole("button", { name: "workspacePane.open" }));
    expect(screen.getAllByRole("tab", { name: "New tab" })).toHaveLength(1);

    // Cmd/Ctrl+W closes the active workbench tab.
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "New tab" })).toBeNull(),
    );
  });

  it("opens independent terminal resources inside the workbench", async () => {
    mocks.useSessions.mockReturnValue(makeSessions());
    let terminalSnapshots: Array<{
      sessionId: string;
      terminalId: string;
      title: string;
      cwd: string;
      output: string;
      sequence: number;
      running: boolean;
      startedAt: number;
    }> = [];
    const development = {
      listCheckpoints: vi.fn().mockResolvedValue([]),
      terminalList: vi.fn(async () => [...terminalSnapshots]),
      terminalStart: vi.fn(async (sessionId: string, terminalId: string) => {
        const existing = terminalSnapshots.find(
          (terminal) => terminal.terminalId === terminalId,
        );
        if (existing) return existing;
        const snapshot = {
          sessionId,
          terminalId,
          title: "zhangdehui@MacBook",
          cwd: "/workspace",
          output: "",
          sequence: 0,
          running: true,
          startedAt: terminalSnapshots.length + 1,
        };
        terminalSnapshots = [...terminalSnapshots, snapshot];
        return snapshot;
      }),
      terminalGet: vi.fn(
        async (_sessionId: string, terminalId: string) =>
          terminalSnapshots.find(
            (terminal) => terminal.terminalId === terminalId,
          ) ?? null,
      ),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      terminalStop: vi.fn(async (_sessionId: string, terminalId: string) => {
        terminalSnapshots = terminalSnapshots.filter(
          (terminal) => terminal.terminalId !== terminalId,
        );
      }),
      onTerminalData: vi.fn(() => () => {}),
    };

    render(
      <WorkbenchExtensionsProvider shells={shells} extensions={[createTerminalView()]}>
      <FullScreenChatView
        client={makeClient() as never}
        capabilities={
          {
            workspaceInspector: { files: {}, development },
          } as never
        }
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />
      </WorkbenchExtensionsProvider>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "workspacePane.open" }));
    expect(document.querySelector("[data-workspace-terminal-panel]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open terminal" }));
    await waitFor(() => expect(development.terminalStart).toHaveBeenCalledTimes(1));
    const firstId = development.terminalStart.mock.calls[0][1];
    await user.click(screen.getByRole("button", { name: "workspacePane.newTab" }));
    await user.click(screen.getByRole("button", { name: "Open terminal" }));
    await waitFor(() => expect(development.terminalStart).toHaveBeenCalledTimes(2));
    const tabs = screen.getAllByRole("tab", { name: "Terminal" });
    expect(tabs).toHaveLength(2);
    await user.click(tabs[0]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getAllByRole("button", { name: "common.close" })[0]);
    await waitFor(() => expect(screen.getAllByRole("tab", { name: "Terminal" })).toHaveLength(1));
    expect(development.terminalStop).toHaveBeenCalledWith("session-1", firstId);
    await user.click(screen.getByRole("button", { name: "workspacePane.collapse" }));
    expect(development.terminalStop).toHaveBeenCalledTimes(1);
  }, 15000);

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
    const contentHeader = contentHeaderLeading?.closest("header");
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

  it("toggles the sidebar with Cmd/Ctrl+B", () => {
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
    expect(sidebar).toHaveStyle({ width: `${APP_SIDEBAR_DEFAULT_WIDTH}px` });

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(sidebar).toHaveStyle({ width: "0px" });

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(sidebar).toHaveStyle({ width: `${APP_SIDEBAR_DEFAULT_WIDTH}px` });
  });

  it("snaps sidebar resizing to the shared default width", async () => {
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
    expect(sidebar.style.transition).toBe("none");
    await waitFor(() => expect(sidebar).toHaveStyle({ width: "260px" }));

    fireEvent(handle, pointerEvent("pointermove", 248));
    fireEvent(handle, pointerEvent("pointerup", 248));
    expect(sidebar).toHaveStyle({ width: "240px" });
    expect(screen.getByTestId("main-sidebar-content")).toHaveStyle({ width: "240px" });
    expect(sidebar.style.transition).toBe("");

    expect(mocks.storageSet).toHaveBeenCalledWith({
      "settings.chat.sidebarWidth": APP_SIDEBAR_DEFAULT_WIDTH,
    });
  });

  it("keeps background completions unread until the chat regains focus", () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const sessions = makeSessions();
    mocks.useSessions.mockReturnValue(sessions);
    render(<FullScreenChatView client={makeClient() as never} openSettings={() => {}} openAgentDestination={() => {}} restoreSidebarViewOnMount={false} />);
    act(() => mocks.streamListener?.("session-1", { kind: "done" }));
    expect(sessions.markUnread).toHaveBeenCalledWith("session-1");
    expect(sessions.markRead).not.toHaveBeenCalled();
    focus.mockReturnValue(true);
    fireEvent.focus(window);
    expect(sessions.markRead).toHaveBeenCalledWith("session-1");
    focus.mockRestore();
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
      expect(screen.getByTestId("plugin-workspace-view")).not.toHaveClass(
        "hidden",
      );
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

/**
 * Official `conversation.session.header.actions` seat (list, session scope,
 * EMPTY owner — the contract is explicit that a header action derives its
 * state from the standard session kit and its own inject face). The chat
 * content header had no title-adjacent action region before this seat, so
 * the one it grew must be invisible until a plugin contributes.
 */
describe("FullScreenChatView session-header action seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embeddedBrowser = null;
    mocks.storageGet.mockResolvedValue({});
    mocks.storageSet.mockResolvedValue(undefined);
    mocks.useSessions.mockReturnValue(makeSessions());
  });

  function renderView(headerActions?: React.ReactNode) {
    return render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
        slots={headerActions === undefined ? undefined : { headerActions }}
      />,
    );
  }

  it("adds no header region while the host dispatches no seat", () => {
    const { container } = renderView();

    expect(
      container.querySelector("[data-content-header-actions]"),
    ).not.toBeInTheDocument();
  });

  it("collapses to nothing while the dispatched seat is empty", () => {
    // What an entry-less official list dispatch renders: a node that
    // produces no DOM. The row must then cost neither a box nor a flex gap.
    const EmptySeat = () => null;
    const { container } = renderView(<EmptySeat />);

    const row = container.querySelector("[data-content-header-actions]");
    expect(row).toBeInTheDocument();
    expect(row!.childNodes).toHaveLength(0);
    // `:empty` + `display:none` is what keeps the collapsed row out of the
    // header's flex layout — an empty flex item would still spend one gap.
    expect(row).toHaveClass("empty:hidden");
  });

  it("renders contributed actions at the chat header edge, separately from window utilities", () => {
    const { container } = renderView(
      <button type="button">contributed-action</button>,
    );

    const row = container.querySelector("[data-content-header-actions]");
    const action = screen.getByRole("button", { name: "contributed-action" });
    expect(row).toContainElement(action);

    // Trailing in the chat column, outside the title cluster.
    const leading = container.querySelector("[data-content-header-leading]");
    expect(leading).not.toContainElement(row as HTMLElement);
    expect(row?.closest(".amiba-chat-column")).toBeTruthy();
    expect(row).toHaveStyle({ gap: "2px" });
    const title = container.querySelector("[data-content-header-title]");
    expect(
      title!.compareDocumentPosition(row as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // ...and NOT in the right-aligned utilities cluster, which is the other
    // official seat (`conversation.session.header.utilities`). Keeping the
    // two regions apart is why upstream declares them as separate seats.
    const utilities = container.querySelector("[data-workspace-edge-toggle]");
    expect(utilities).not.toContainElement(action);
  });

  it("keeps equal gaps beside the toggle and follows the chat boundary as the pane resizes", () => {
    let chatRight = 1200;
    let controlsLeft = 1160;
    const resizeCallbacks: Array<() => void> = [];
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("amiba-chat-column")) return { right: chatRight } as DOMRect;
      if (this.hasAttribute("data-workspace-edge-toggle")) return { left: controlsLeft, width: 28 } as DOMRect;
      return { width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 } as DOMRect;
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizeCallbacks.push(callback); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    try {
      const { container } = renderView(<><button>Sync</button><button>Transcript</button></>);
      const actions = container.querySelector("[data-content-header-actions]") as HTMLElement;
      const header = actions.closest("header")!;
      const controls = container.querySelector("[data-workspace-edge-toggle]") as HTMLElement;
      const column = container.querySelector(".amiba-chat-column") as HTMLElement;
      const inset = () => parseFloat(column.style.getPropertyValue("--amiba-header-actions-right"));
      expect(header.style.paddingRight).toBe("var(--amiba-header-actions-right, 12px)");
      expect(actions.style.gap).toBe(controls.style.gap);
      expect(chatRight - inset()).toBe(controlsLeft - 2);
      // Opening/resizing the pane moves only the chat boundary, not window controls.
      chatRight = 760;
      act(() => resizeCallbacks.forEach(callback => callback()));
      expect(inset()).toBe(12);
      expect(chatRight - inset()).toBe(748);
      // Each animation frame must update synchronously, without waiting for
      // React/act to flush a render. The row may approach but never overshoot.
      let previousRight = chatRight - inset();
      for (const right of [1000, 1150, 1160, 1170, 1190, 1200]) {
        chatRight = right;
        resizeCallbacks.forEach(callback => callback());
        const actionRight = chatRight - inset();
        expect(actionRight).toBeGreaterThanOrEqual(previousRight);
        expect(actionRight).toBeLessThanOrEqual(controlsLeft - 2);
        previousRight = actionRight;
      }
      // Closing the pane and adding another utility preserves the same 2px gap.
      chatRight = 1200;
      controlsLeft = 1130;
      act(() => resizeCallbacks.forEach(callback => callback()));
      expect(chatRight - inset()).toBe(controlsLeft - 2);
    } finally {
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("resets the stored sidebar view when landing on home without restoring it", async () => {
    // View switches are storage-CHANGE driven: a plugin nav row's
    // openWorkspace writes `settings.chat.sidebarView` and this component's
    // watch reacts. Desktop mounts with restoreSidebarViewOnMount={false} so
    // every launch lands on home — but the persisted key still held the last
    // view, so clicking that same view wrote a no-change value and the watch
    // never fired: the nav row "did not respond" until opening a session
    // rewrote the key. Not restoring the view must therefore RESET it.
    mocks.useSessions.mockReturnValue(makeSessions());
    mocks.storageGet.mockImplementation(async (key: string | string[]) => {
      if (key === "settings.chat.sidebarView") return { [key]: "cron" };
      return {};
    });
    render(
      <FullScreenChatView
        client={makeClient() as never}
        openSettings={() => {}}
        openAgentDestination={() => {}}
        restoreSidebarViewOnMount={false}
      />,
    );
    await act(async () => {});
    expect(mocks.storageSet).toHaveBeenCalledWith({
      "settings.chat.sidebarView": "chats",
    });
  });
});

describe("FullScreenChatView session header corner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embeddedBrowser = null;
    mocks.storageGet.mockResolvedValue({});
    mocks.storageSet.mockResolvedValue(undefined);
    mocks.useSessions.mockReturnValue(makeSessions());
  });
  function view(headerCorner?: React.ReactNode) {
    return <FullScreenChatView
      client={makeClient() as never}
      openSettings={() => {}}
      openAgentDestination={() => {}}
      restoreSidebarViewOnMount={false}
      slots={{ headerCorner }}
    />;
  }
  it("adds no corner box without a contribution and collapses empty renderers", () => {
    const result = render(view());
    expect(result.container.querySelector("[data-conversation-header-corner]")).toBeNull();
    const Empty = () => null;
    result.rerender(view(<Empty />));
    const corner = result.container.querySelector("[data-conversation-header-corner]");
    expect(corner).toHaveClass("empty:hidden");
    expect(corner?.childNodes).toHaveLength(0);
  });
  it("places the control after the existing controls and preserves the title", () => {
    const clicked = vi.fn();
    const result = render(view());
    const row = result.container.querySelector("[data-workspace-edge-toggle]")!;
    const nativeControls = Array.from(row.children);
    const title = result.container.querySelector("[data-content-header-title]")!;
    const originalTitle = title.outerHTML;
    result.rerender(view(<button onClick={clicked}>Corner control</button>));
    const corner = result.container.querySelector("[data-conversation-header-corner]")!;
    expect(row.lastElementChild).toBe(corner);
    nativeControls.forEach((control, index) => expect(row.children[index]).toBe(control));
    expect(title.outerHTML).toBe(originalTitle);
    fireEvent.click(screen.getByRole("button", { name: "Corner control" }));
    expect(clicked).toHaveBeenCalledTimes(1);
    result.rerender(view());
    expect(row.children).toHaveLength(nativeControls.length);
    expect(title.outerHTML).toBe(originalTitle);
  });
  it("contains an extension error without losing the native header", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const Broken = (): never => { throw new Error("corner failed"); };
      const result = render(view(<Broken />));
      expect(result.container.querySelector("[data-content-header-title]")).toHaveTextContent("Existing conversation");
      expect(result.container.querySelector("[data-workspace-edge-toggle] button")).toBeInTheDocument();
      expect(result.container.querySelector("[data-conversation-header-corner]")?.childNodes).toHaveLength(0);
    } finally { errors.mockRestore(); }
  });
});

describe("FullScreenChatView session lineage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.embeddedBrowser = null;
    mocks.storageGet.mockResolvedValue({});
    mocks.storageSet.mockResolvedValue(undefined);
    mocks.useSessions.mockReturnValue(makeSessions());
  });
  function view(headerLineage?: React.ReactNode) {
    return <FullScreenChatView client={makeClient() as never}
      openSettings={() => {}} openAgentDestination={() => {}}
      restoreSidebarViewOnMount={false} slots={{ headerLineage }} />;
  }
  it("preserves the native title and its rename operation while navigation is mounted", async () => {
    const sessions = makeSessions();
    mocks.useSessions.mockReturnValue(sessions);
    const result = render(view());
    const title = result.container.querySelector("[data-content-header-title]")!;
    const navigate = vi.fn();
    result.rerender(view(<button onClick={navigate}>Open ancestor</button>));
    expect(result.container.querySelector("[data-content-header-title]")).toBe(title);
    await userEvent.click(screen.getByRole("button", { name: "Open ancestor" }));
    expect(navigate).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "chat.rename" }));
    const editor = screen.getByRole("textbox", { name: "chat.rename" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "Lineage keeps rename{Enter}");
    expect(sessions.rename).toHaveBeenCalledWith(sessions.activeId, "Lineage keeps rename");
    result.rerender(view());
    expect(result.container.querySelector("[data-content-header-lineage]")).toBeNull();
    expect(result.container.querySelector("[data-content-header-title]")).toBe(title);
  });
  it("collapses empty content and recovers after a failing contribution is replaced", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const Empty = () => null;
      const Broken = (): never => { throw new Error("lineage failed"); };
      const result = render(view(<Empty />));
      const row = result.container.querySelector("[data-content-header-lineage]")!;
      expect(row).toHaveClass("empty:hidden");
      expect(row.childNodes).toHaveLength(0);
      result.rerender(view(<Broken />));
      expect(row.childNodes).toHaveLength(0);
      expect(result.container.querySelector("[data-content-header-title]")).toHaveTextContent("Existing conversation");
      result.rerender(view(<button>Recovered lineage</button>));
      expect(screen.getByRole("button", { name: "Recovered lineage" })).toBeInTheDocument();
    } finally { errors.mockRestore(); }
  });
});
