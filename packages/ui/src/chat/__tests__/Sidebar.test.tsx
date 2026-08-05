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
    onOpenTaskCenter: vi.fn(),
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
    await userEvent.click(screen.getByText("First chat"));
    expect(props.onOpenSession).toHaveBeenCalledWith("s1");
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
    expect(unread.firstElementChild).toHaveClass("h-1.5", "w-1.5");
    expect(unread.firstElementChild?.firstElementChild).toHaveClass(
      "opacity-0",
      "duration-200",
    );
    expect(unread.firstElementChild?.lastElementChild).toHaveClass(
      "h-1.5",
      "w-1.5",
    );
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
    expect(running.firstElementChild).toHaveClass("h-1.5", "w-1.5");
    expect(running.firstElementChild?.firstElementChild).toHaveClass(
      "amiba-session-status-breathe",
      "duration-200",
    );
    expect(running.firstElementChild?.lastElementChild).toHaveClass(
      "h-1.5",
      "w-1.5",
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

  it("switches history layout from the header controls", async () => {
    const props = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "Group chats by workspace" }),
    );
    expect(props.onHistoryLayoutChange).toHaveBeenCalledWith("grouped");
  });

  it("opens the task center without adding a fixed task nav row", async () => {
    const props = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "View all tasks" }),
    );
    expect(props.onOpenTaskCenter).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("sidebar-item-tasks")).not.toBeInTheDocument();
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
