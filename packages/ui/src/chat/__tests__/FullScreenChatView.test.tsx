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
  sidebarRunningSessionIds: [] as string[],
  sidebarFailedSessionIds: [] as string[],
  embeddedBrowser: null as null | Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@amiba/app-runtime/core", () => ({
  useSessions: mocks.useSessions,
}));

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
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
    onNewChat,
    runningSessionIds,
    failedSessionIds,
  }: {
    onNewChat: () => void;
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
    let requestBrowserTab: (() => void) | null = null;
    mocks.embeddedBrowser = {
      registerTab: vi.fn().mockResolvedValue({}),
      unregisterTab: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn().mockResolvedValue({}),
      command: vi.fn().mockResolvedValue({}),
      detectDevServers: vi.fn().mockResolvedValue([]),
      onCreateRequested: vi.fn((listener: () => void) => {
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
      />,
    );

    const browserToggle = screen.getByRole("button", {
      name: "embeddedBrowser.open",
    });
    const terminalToggle = screen.getByRole("button", {
      name: "workspacePane.openTerminal",
    });
    const workbenchToggle = screen.getByRole("button", {
      name: "workspacePane.open",
    });
    const controls = browserToggle.parentElement;
    expect(controls?.children[0]).toBe(browserToggle);
    expect(controls?.children[1]).toBe(terminalToggle);
    expect(controls?.children[2]).toBe(workbenchToggle);

    act(() => requestBrowserTab?.());
    expect(
      screen.queryByRole("button", { name: "workspacePane.openTerminal" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "workspacePane.collapse" }),
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-embedded-browser-pane]"),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-embedded-browser-workspace]"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "embeddedBrowser.newTab" }),
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

    await userEvent.click(
      screen.getByRole("button", { name: "embeddedBrowser.close" }),
    );
    const restoredWorkbenchToggle = screen.getByRole("button", {
      name: "workspacePane.open",
    });
    expect(
      screen.getByRole("button", { name: "embeddedBrowser.open" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(restoredWorkbenchToggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(
      screen.getByRole("button", { name: "embeddedBrowser.open" }),
    );
    expect(
      screen.getByRole("button", { name: "workspacePane.collapse" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByRole("tab", { name: "embeddedBrowser.newTab" }),
    ).toHaveLength(1);
  });

  it("opens a bottom terminal drawer with independent tabs", async () => {
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
      />,
    );

    const workbenchToggle = screen.getByRole("button", {
      name: "workspacePane.open",
    });
    const terminalToggle = screen.getByRole("button", {
      name: "workspacePane.openTerminal",
    });
    const toggleLayer = workbenchToggle.parentElement;
    const panel = document.querySelector("[data-workspace-terminal-panel]");

    expect(toggleLayer?.children[0]).toBe(terminalToggle);
    expect(toggleLayer?.children[1]).toBe(workbenchToggle);
    expect(terminalToggle.querySelector(".lucide-panel-bottom")).not.toBeNull();
    expect(panel).toHaveStyle({ height: "0px" });

    await userEvent.click(terminalToggle);

    expect(
      screen.getByRole("button", { name: "workspacePane.closeTerminal" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(panel).toHaveStyle({ height: "280px" });
    expect(panel?.parentElement?.children[0]).toHaveAttribute(
      "data-workspace-main-row",
    );
    const initialTab = await screen.findByRole("tab", {
      name: "zhangdehui@MacBook",
    });
    const tabsBar = document.querySelector(
      "[data-workspace-terminal-tabs-bar]",
    );
    expect(tabsBar).not.toHaveClass("border-b", "bg-muted");
    expect(tabsBar).toHaveClass("px-3");
    expect(tabsBar?.className).not.toContain("bg-[");
    expect(initialTab).toHaveAttribute("aria-selected", "true");
    expect(development.terminalStart).toHaveBeenCalledWith(
      "session-1",
      "primary",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "workspacePane.newTerminal" }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("tab", { name: "zhangdehui@MacBook" }),
      ).toHaveLength(2),
    );
    const tabs = screen.getAllByRole("tab", {
      name: "zhangdehui@MacBook",
    });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tabs[0]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    await userEvent.click(
      screen.getAllByRole("button", {
        name: "workspacePane.closeTerminalTab",
      })[0],
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("tab", { name: "zhangdehui@MacBook" }),
      ).toHaveLength(1),
    );
    expect(development.terminalStop).toHaveBeenCalledWith(
      "session-1",
      "primary",
    );

    await userEvent.click(
      screen.getByRole("button", { name: "workspacePane.hideTerminalPanel" }),
    );
    expect(panel).toHaveStyle({ height: "0px" });
    expect(development.terminalStop).toHaveBeenCalledTimes(1);
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

  it("renders a contributed action title-adjacent, not in the utilities strip", () => {
    const { container } = renderView(
      <button type="button">contributed-action</button>,
    );

    const row = container.querySelector("[data-content-header-actions]");
    const action = screen.getByRole("button", { name: "contributed-action" });
    expect(row).toContainElement(action);

    // Title-adjacent: inside the header's leading cluster, after the title.
    const leading = container.querySelector("[data-content-header-leading]");
    expect(leading).toContainElement(row as HTMLElement);
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
