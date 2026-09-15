import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";
import type { SessionListGroup } from "../session-list-extensions";

vi.mock("../../profile/profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../profile/profile")>();
  return { ...actual, usePersonalProfile: () => ({ profile: actual.DEFAULT_PROFILE }) };
});

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
  const onSelectView = vi.fn();
  const props = {
    onNewChat: vi.fn(),
    onNewWorkspaceChat: vi.fn(),
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
    onRefreshSessions: vi.fn(),
    onOpenSettings: vi.fn(),
    workspaceNavigation: (
      <button
        data-testid="sidebar-item-scheduled"
        type="button"
        onClick={() => onSelectView("scheduled")}
      >
        Automation
      </button>
    ),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return { ...props, onSelectView };
}

describe("Sidebar", () => {
  it("supplies the actual rail state to additive footer controls without replacing settings", async () => {
    const action = vi.fn();
    const footer = vi.fn(({ wide }: { wide: boolean }) => <button onClick={action}>{wide ? "Plugin action" : "Plugin icon"}</button>);
    const props = setup({ wide: false, sidebarFooterActions: footer });
    expect(footer).toHaveBeenCalledWith({ wide: false });
    await userEvent.click(screen.getByRole("button", { name: "Plugin icon" }));
    expect(action).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("sidebar-item-personal"));
    await userEvent.click(screen.getByTestId("sidebar-item-settings"));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });
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

  it("selects a workspace plugin nav view", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("sidebar-item-scheduled"));
    expect(props.onSelectView).toHaveBeenCalledWith("scheduled");
  });

  it("opens personal settings from the profile menu header", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("sidebar-item-personal"));
    expect(props.onOpenSettings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("menuitem", { name: "Personal" }));
    expect(props.onOpenSettings).toHaveBeenCalledWith("personal");
  });

  it("opens settings from the footer row", async () => {
    const props = setup();
    expect(screen.queryByTestId("sidebar-item-settings")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("sidebar-item-personal"));
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
        .slice(0, 2)
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Create branch"]);
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
      bySessionId: { s1: "/Users/amira/Code/amiba-project" },
    };
    setup({
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
      bySessionId: { s1: "/Users/amira/Code/amiba-project" },
    };
    setup({
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

  it("groups related conversations beneath their workspace directory", async () => {
    workspaceBindings.current = {
      supported: true,
      ready: true,
      bySessionId: {
        s1: "/Users/amira/Code/amiba-project",
        s2: "/Users/amira/Code/amiba-project",
        s3: "/Users/amira/Code/superun",
      },
    };
    setup({
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

    const workspaceGroup = screen.getByRole("button", { name: "amiba-project" });
    expect(workspaceGroup).toHaveAttribute("title", "/Users/amira/Code/amiba-project");
    expect(workspaceGroup).toHaveClass("h-full", "w-full", "px-2.5");
    expect(workspaceGroup.parentElement).not.toHaveClass("px-2.5");
    expect(screen.getByText("superun")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Refine workbench")).toBeInTheDocument();
    expect(screen.getByText("Fix tool cards")).toBeInTheDocument();

    await userEvent.click(workspaceGroup);
    expect(screen.queryByText("Refine workbench")).not.toBeInTheDocument();
    expect(screen.queryByText("Fix tool cards")).not.toBeInTheDocument();
    expect(screen.getByText("Review analytics")).toBeInTheDocument();
  });

  it("keeps bulk selection inside the overflow menu", async () => {
    const props = setup({
      onArchiveSessions: vi.fn(),
    });
    const header = screen.getByTestId("sessions-header");
    expect(header).toHaveClass("h-7");
    expect(header.querySelector("button")).toHaveClass("px-2.5");

    expect(
      screen.queryByRole("button", { name: "Select tasks" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "More task actions" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Import tasks…" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Select tasks" }),
    );
    expect(header).toHaveTextContent("0 selected");
    expect(header).not.toHaveTextContent("Workspaces");
    expect(
      screen.queryByRole("button", { name: "More task actions" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("First chat"));
    expect(header).toHaveTextContent("1 selected");
    // Archive is the ONLY batch action now — no bulk remove, no unarchive.
    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unarchive" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(props.onArchiveSessions).toHaveBeenCalledWith(["s1"]);
  });

  it("reuses the grouped status slot for selection without shifting titles", async () => {
    workspaceBindings.current = {
      supported: true,
      ready: true,
      bySessionId: { s1: "/Users/amira/Code/amiba-project" },
    };
    setup({
      onArchiveSessions: vi.fn(),
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

describe("Sidebar plugin-group sections", () => {
  const stewardGroup: SessionListGroup = {
    id: "steward",
    label: "Steward group",
    claim: (session) => session.source === "steward",
  };

  it("renders plugin groups after the built-in 工作空间 section", () => {
    setup({
      groups: [stewardGroup],
      sessions: [
        {
          id: "s1",
          title: "Claimed chat",
          createdAt: 1,
          updatedAt: 2,
          source: "steward",
        },
        {
          id: "s2",
          title: "Unclaimed chat",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const groupHeader = screen.getByText("Steward group");
    const recentHeader = screen.getByText("Workspaces");
    // The built-in history section always owns the first section position;
    // slot-registered groups follow it in registration order.
    expect(
      recentHeader.compareDocumentPosition(groupHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The claimed session appears exactly once, under the group section —
    // not duplicated into the built-in recent-tasks list.
    expect(screen.getAllByText("Claimed chat")).toHaveLength(1);
    const claimedRow = screen.getByText("Claimed chat");
    expect(
      groupHeader.compareDocumentPosition(claimedRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The unclaimed session is unaffected — still in the regular list.
    expect(screen.getByText("Unclaimed chat")).toBeInTheDocument();
  });

  it("collapses recent tasks from the title while keeping the menu independent", async () => {
    workspaceBindings.current.bySessionId = { s2: "/work/project" };
    setup({
      onArchiveSessions: vi.fn(),
      groups: [stewardGroup],
      sessions: [
        {
          id: "s1",
          title: "Claimed chat",
          createdAt: 1,
          updatedAt: 2,
          source: "steward",
        },
        {
          id: "s2",
          title: "Unclaimed chat",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const menu = screen.getByRole("button", { name: "More task actions" });
    const collapse = screen.getByRole("button", { name: "Workspaces" });
    expect(collapse).toHaveTextContent("Workspaces");
    expect(collapse).not.toContainElement(menu);
    await userEvent.click(menu);
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(collapse);
    expect(collapse).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Unclaimed chat")).not.toBeInTheDocument();
    // Collapsing the built-in section does not collapse plugin sections.
    expect(screen.getByText("Claimed chat")).toBeInTheDocument();

    await userEvent.click(collapse);
    expect(screen.getByText("Unclaimed chat")).toBeInTheDocument();
  });

  it("renders no header for a group nothing claims", () => {
    setup({
      groups: [{ id: "empty", label: "Empty group", claim: () => false }],
    });
    expect(screen.queryByText("Empty group")).not.toBeInTheDocument();
  });

  it("collapsing a group header hides its rows", async () => {
    setup({
      groups: [stewardGroup],
      sessions: [
        {
          id: "s1",
          title: "Claimed chat",
          createdAt: 1,
          updatedAt: 1,
          source: "steward",
        },
      ],
    });

    expect(screen.getByText("Claimed chat")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Steward group" }),
    );
    expect(screen.queryByText("Claimed chat")).not.toBeInTheDocument();

    // Toggling again brings it back.
    await userEvent.click(
      screen.getByRole("button", { name: "Steward group" }),
    );
    expect(screen.getByText("Claimed chat")).toBeInTheDocument();
  });

  it("does not render any plugin-group chrome when groups is absent", () => {
    setup({
      sessions: [
        { id: "s1", title: "Only chat", createdAt: 1, updatedAt: 1 },
      ],
    });
    expect(screen.getByText("Only chat")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
  });
});

it("separates tasks from workspaces and starts a draft in the selected directory", async () => {
  workspaceBindings.current.bySessionId = { project: String.raw`C:\Users\amira\Code\sample` };
  const props = setup({ sessions: [
    { id: "task", title: "Default task", createdAt: 1, updatedAt: 1 },
    { id: "project", title: "Project task", createdAt: 2, updatedAt: 2 },
  ] });
  const tasks = screen.getByRole("button", { name: "Tasks" }).closest("section")!;
  const workspaces = screen.getByTestId("sessions-header").closest("section")!;
  expect(within(tasks).getByText("Default task")).toBeInTheDocument();
  expect(within(tasks).queryByText("Project task")).not.toBeInTheDocument();
  expect(within(workspaces).queryByText("Default task")).not.toBeInTheDocument();
  const header = screen.getByRole("button", { name: "sample" });
  expect(header.querySelector(".lucide-chevron-down")).toBeNull();
  const create = screen.getByRole("button", { name: "New task in sample" });
  await userEvent.click(create);
  expect(props.onNewWorkspaceChat).toHaveBeenCalledWith(String.raw`C:\Users\amira\Code\sample`);
  expect(props.onNewChat).not.toHaveBeenCalled();
  expect(header).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(header);
  expect(header).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(create);
  expect(props.onNewWorkspaceChat).toHaveBeenCalledTimes(2);
});

it("uses the same header component for tasks, workspaces, and plugin groups", () => {
  setup({ sessions: [
    { id: "task", title: "Default task", createdAt: 1, updatedAt: 1 },
    { id: "cron", title: "Scheduled task", createdAt: 2, updatedAt: 2 },
    { id: "external", title: "External task", createdAt: 3, updatedAt: 3 },
  ], groups: [
    { id: "cron", label: "Scheduled", claim: session => session.id === "cron" },
    { id: "external", label: "External", claim: session => session.id === "external" },
  ] });
  const headers = ["Tasks", "Workspaces", "Scheduled", "External"].map(name =>
    screen.getByRole("button", { name }).closest('[data-section-header="rail"]')!,
  );
  expect(headers.every(header => header.className === headers[0].className)).toBe(true);
  expect(headers.every(header => header.getAttribute("style") === headers[0].getAttribute("style"))).toBe(true);
});
