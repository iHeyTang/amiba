import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";

const workspaceBindings = vi.hoisted(() => ({
  current: {
    supported: false,
    ready: true,
    bySessionId: {} as Record<string, string>,
  },
}));

vi.mock("../internal/useWorkspaceBindings", () => ({
  useWorkspaceBindings: () => workspaceBindings.current,
}));

beforeEach(() => {
  workspaceBindings.current = {
    supported: false,
    ready: true,
    bySessionId: {},
  };
});

function setup(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    activeView: "chats",
    onSelectView: vi.fn(),
    onNewChat: vi.fn(),
    extensionItems: [],
    sessions: [
      {
        id: "s1",
        title: "First chat",
        createdAt: 1,
        updatedAt: 1,
        messageCount: 1,
      },
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
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar", () => {
  it("starts with task actions without a redundant workspace label", () => {
    setup();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-item-new-chat")).toHaveTextContent(
      "New task",
    );
  });

  it("fires onNewChat from the new-chat row", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("sidebar-item-new-chat"));
    expect(props.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("selects a built-in nav view", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("sidebar-item-scheduled"));
    expect(props.onSelectView).toHaveBeenCalledWith("scheduled");
  });

  it("shows capability extensions as a first-class main destination", async () => {
    const props = setup({ showCapabilityExtensions: true });
    await userEvent.click(
      screen.getByTestId("sidebar-item-capability-extensions"),
    );
    expect(props.onSelectView).toHaveBeenCalledWith("capability-extensions");
  });

  it("selects an extension nav view by its extensionId", async () => {
    const props = setup({
      extensionItems: [
        {
          extensionId: "village",
          icon: "book-open",
          label: "Village",
          viewUrl: "x",
          order: 100,
        },
      ],
    });
    await userEvent.click(screen.getByTestId("sidebar-item-village"));
    expect(props.onSelectView).toHaveBeenCalledWith("village");
  });

  it("opens settings from the footer row", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("sidebar-item-settings"));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders the conversation history and opens a row", async () => {
    const props = setup();
    const title = screen.getByText("First chat");
    expect(title.closest("button")?.textContent).toBe("First chat");
    await userEvent.click(title);
    expect(props.onOpenSession).toHaveBeenCalledWith("s1");
  });

  it("fades row actions over the title with a state-matched mask", () => {
    setup();
    const moreButton = screen.getByRole("button", {
      name: "More actions",
    });
    const hoverActions = moreButton.parentElement;
    expect(hoverActions).toHaveClass(
      "pointer-events-none",
      "bg-gradient-to-l",
      "from-accent",
      "to-transparent",
      "pl-8",
    );
    expect(hoverActions).not.toHaveClass("group-hover:pointer-events-auto");
    expect(moreButton).toHaveClass(
      "pointer-events-none",
      "group-hover:pointer-events-auto",
    );
  });

  it("keeps rename inside the per-session overflow menu", async () => {
    const props = setup({
      onBranchSession: vi.fn(),
      onPinSession: vi.fn(),
    });

    expect(
      screen.queryByRole("menuitem", { name: "Rename" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(menu).toHaveAttribute("data-side", "bottom");
    expect(menu).toHaveAttribute("data-align", "start");
    expect(menu).toHaveClass("w-52");
    expect(
      screen.getByRole("menuitem", { name: "Create branch" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("menuitem")
        .slice(0, 3)
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Pin", "Create branch"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("First chat");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed chat{enter}");
    expect(props.onRenameSession).toHaveBeenCalledWith("s1", "Renamed chat");
  });

  it("keeps only one per-session overflow menu open", async () => {
    setup({
      sessions: [
        {
          id: "s1",
          title: "First chat",
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
        },
        {
          id: "s2",
          title: "Second chat",
          createdAt: 1,
          updatedAt: 1,
          messageCount: 1,
        },
      ],
    });

    const [firstMenu, secondMenu] = screen.getAllByRole("button", {
      name: "More actions",
    });

    await userEvent.click(firstMenu!);
    expect(firstMenu).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(secondMenu!);
    const [updatedFirstMenu, updatedSecondMenu] = screen.getAllByRole(
      "button",
      {
        name: "More actions",
      },
    );
    expect(updatedFirstMenu).toHaveAttribute("aria-expanded", "false");
    expect(updatedSecondMenu).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem", { name: "Rename" })).toHaveLength(1);
  });

  it("renders a quiet status dot for unread session updates", () => {
    workspaceBindings.current = {
      supported: true,
      ready: true,
      bySessionId: { s1: "/Users/amira/Code/hermes-x" },
    };
    setup({
      historyLayout: "grouped",
      sessions: [
        {
          id: "s1",
          title: "First chat",
          createdAt: 1,
          updatedAt: 1,
          messageCount: 1,
          unread: true,
        },
      ],
    });

    const unread = screen.getByLabelText("Unread update");
    expect(unread).toHaveClass("left-2", "h-4", "w-4");
    expect(unread.firstElementChild).toHaveClass(
      "amiba-session-status-dot",
      "h-1.5",
      "w-1.5",
      "bg-[hsl(var(--status-session))]",
    );
    expect(unread.firstElementChild).not.toHaveClass("duration-300");
    expect(unread.nextElementSibling?.tagName).toBe("BUTTON");
    expect(unread.nextElementSibling).toHaveTextContent("First chat");
  });

  it("uses the same leading status slot for a running session", () => {
    workspaceBindings.current = {
      supported: true,
      ready: true,
      bySessionId: { s1: "/Users/amira/Code/hermes-x" },
    };
    setup({
      historyLayout: "grouped",
      runningSessionIds: new Set(["s1"]),
      sessions: [
        {
          id: "s1",
          title: "First chat",
          createdAt: 1,
          updatedAt: 1,
          messageCount: 1,
          unread: true,
        },
      ],
    });

    const running = screen.getByLabelText("Running");
    expect(screen.queryByLabelText("Unread update")).not.toBeInTheDocument();
    expect(running).toHaveClass("left-2", "h-4", "w-4");
    expect(running.firstElementChild).toHaveClass(
      "amiba-session-status-dot",
      "h-1.5",
      "w-1.5",
      "amiba-session-status-breathe",
      "bg-muted-foreground/80",
    );
    expect(running.firstElementChild).not.toHaveClass(
      "bg-[hsl(var(--status-session))]",
    );
    expect(running.firstElementChild).not.toHaveClass("duration-300");
  });

  it("shows an orange status dot when a session ends with an error", () => {
    setup({
      failedSessionIds: new Set(["s1"]),
      sessions: [
        {
          id: "s1",
          title: "First chat",
          createdAt: 1,
          updatedAt: 1,
          messageCount: 1,
          unread: true,
        },
      ],
    });

    const failed = screen.getByLabelText("Run failed");
    expect(screen.queryByLabelText("Unread update")).not.toBeInTheDocument();
    expect(failed.firstElementChild).toHaveClass(
      "amiba-session-status-dot",
      "bg-[hsl(var(--warning))]",
    );
    expect(failed.firstElementChild).not.toHaveClass(
      "amiba-session-status-breathe",
      "bg-[hsl(var(--status-session))]",
    );
  });

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
    });

    expect(screen.getByText("First chat")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Daily report · Jul 22, 11:30"));
    expect(props.onOpenScheduledSession).toHaveBeenCalledWith("cron_daily_1");
  });

  it("renders tasks and automation in the compact workspace layout", () => {
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
    });

    expect(screen.getByText("Independent tasks")).toBeInTheDocument();
    expect(screen.getAllByText("Automation").length).toBeGreaterThan(0);
  });

  it("groups related conversations beneath their workspace directory", async () => {
    workspaceBindings.current = {
      supported: true,
      ready: true,
      bySessionId: {
        s1: "/Users/amira/Code/hermes-x",
        s2: "/Users/amira/Code/hermes-x",
        s3: "/Users/amira/Code/superun",
      },
    };
    setup({
      historyLayout: "grouped",
      sessions: [
        {
          id: "s1",
          title: "Refine workbench",
          createdAt: 4,
          updatedAt: 4,
          messageCount: 1,
        },
        {
          id: "s2",
          title: "Fix tool cards",
          createdAt: 3,
          updatedAt: 3,
          messageCount: 1,
        },
        {
          id: "s3",
          title: "Review analytics",
          createdAt: 2,
          updatedAt: 2,
          messageCount: 1,
        },
        {
          id: "s4",
          title: "General question",
          createdAt: 1,
          updatedAt: 1,
          messageCount: 1,
        },
      ],
    });

    const hermesGroup = screen.getByRole("button", { name: "hermes-x" });
    expect(hermesGroup).toHaveAttribute("title", "/Users/amira/Code/hermes-x");
    expect(hermesGroup).toHaveClass("h-full", "w-full", "px-2.5");
    expect(hermesGroup.parentElement).not.toHaveClass("px-2.5");
    expect(screen.getByText("superun")).toBeInTheDocument();
    expect(screen.getByText("Independent tasks")).toBeInTheDocument();
    expect(screen.getByText("Refine workbench")).toBeInTheDocument();
    expect(screen.getByText("Fix tool cards")).toBeInTheDocument();

    await userEvent.click(hermesGroup);
    expect(screen.queryByText("Refine workbench")).not.toBeInTheDocument();
    expect(screen.queryByText("Fix tool cards")).not.toBeInTheDocument();
    expect(screen.getByText("Review analytics")).toBeInTheDocument();
  });

  it("switches history layout from the overflow submenu", async () => {
    const props = setup();
    expect(
      screen.queryByRole("button", { name: "Group chats by workspace" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "More task actions" }),
    );
    expect(
      screen.getByRole("menu", { name: "More task actions" }),
    ).toHaveAttribute("data-align", "start");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Display mode" }),
    );
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    expect(
      screen.getByRole("menuitem", { name: "Display mode" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("menuitemradio", {
        name: "Group chats by workspace",
      }),
    );
    expect(props.onHistoryLayoutChange).toHaveBeenCalledWith("grouped");
  });

  it("keeps import and bulk selection inside the overflow menu", async () => {
    const props = setup({
      onImportSessions: vi.fn(),
      onBulkSessions: vi.fn(),
    });
    const header = screen.getByTestId("sessions-header");
    expect(header).toHaveClass("pr-1.5");

    expect(
      screen.queryByRole("button", { name: "Import tasks…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select tasks" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "More task actions" }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Import tasks…" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Select tasks" }),
    );
    expect(header).toHaveTextContent("0 selected");
    expect(header).not.toHaveTextContent("Recent tasks");
    expect(
      screen.queryByRole("button", { name: "More task actions" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-item-tasks")).toBeInTheDocument();

    await userEvent.click(screen.getByText("First chat"));
    expect(header).toHaveTextContent("1 selected");
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(props.onBulkSessions).toHaveBeenCalledWith(["s1"], "archive");
  });

  it("reuses the grouped status slot for selection without shifting titles", async () => {
    workspaceBindings.current = {
      supported: true,
      ready: true,
      bySessionId: { s1: "/Users/amira/Code/hermes-x" },
    };
    setup({
      historyLayout: "grouped",
      onBulkSessions: vi.fn(),
    });

    await userEvent.click(
      screen.getByRole("button", { name: "More task actions" }),
    );
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Select tasks" }),
    );

    const titleButton = screen.getByRole("button", { name: "First chat" });
    expect(titleButton).toHaveClass("pl-8");
    expect(titleButton).toHaveAttribute("aria-pressed", "false");
    const selectionSlot = titleButton.previousElementSibling;
    expect(selectionSlot).toHaveClass("absolute", "left-2", "h-4", "w-4");
    expect(selectionSlot).toHaveAttribute("aria-hidden", "true");

    await userEvent.click(titleButton);
    expect(titleButton).toHaveAttribute("aria-pressed", "true");
    expect(titleButton).toHaveClass("pl-8");
  });

  it("opens the task board from the primary navigation", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("sidebar-item-tasks"));
    expect(props.onSelectView).toHaveBeenCalledWith("tasks");
  });

  it("reveals history in batches of twenty with stable copy", async () => {
    setup({
      sessions: Array.from({ length: 45 }, (_, index) => ({
        id: `s${index + 1}`,
        title: `Chat ${index + 1}`,
        createdAt: 45 - index,
        updatedAt: 45 - index,
        messageCount: 1,
      })),
    });

    expect(screen.getByText("Chat 20")).toBeInTheDocument();
    expect(screen.queryByText("Chat 21")).not.toBeInTheDocument();
    const showMore = screen.getByRole("button", { name: "Show more" });

    await userEvent.click(showMore);
    expect(screen.getByText("Chat 40")).toBeInTheDocument();
    expect(screen.queryByText("Chat 41")).not.toBeInTheDocument();

    await userEvent.click(showMore);
    expect(screen.getByText("Chat 45")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show more" }),
    ).not.toBeInTheDocument();
  });
});
