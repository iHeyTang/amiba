/**
 * Integration guard for the sidebar's session-list visibility: archived rows
 * and hidden-preset rows must never render, and the archive actions (single
 * + batch) must still work even though there is no way back to an archived
 * row afterward (DSH ships no unarchive yet — this will be revisited once it
 * does). These tests render the REAL `Sidebar` so a regression in either
 * `visibleChatSessions` or `Sidebar`'s own defensive filtering shows up here,
 * not just in the unit tests for the helper.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@amiba/app-runtime/core";
import { Sidebar, type SidebarProps } from "../Sidebar";
import { visibleChatSessions } from "../session-visibility";

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

const ALL_SESSIONS: SessionMeta[] = [
  { id: "s1", title: "Live chat", createdAt: 1, updatedAt: 3 },
  { id: "s9", title: "Filed chat", createdAt: 1, updatedAt: 2, archived: true },
  {
    id: "sh",
    title: "Steward chat",
    createdAt: 1,
    updatedAt: 4,
    agent: { profileId: "steward" },
  },
  {
    id: "shx",
    title: "Steward filed chat",
    createdAt: 1,
    updatedAt: 5,
    archived: true,
    agent: { profileId: "steward" },
  },
];

function renderSidebar(
  sessions: SessionMeta[],
  overrides: Partial<SidebarProps> = {},
) {
  const props: SidebarProps = {
    onNewChat: vi.fn(),
    sessions,
    activeSessionId: "",
    sessionsReady: true,
    onOpenSession: vi.fn(),
    onRenameSession: vi.fn(),
    onRefreshSessions: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  const view = render(<Sidebar {...props} />);
  return { ...view, props };
}

describe("sidebar session list visibility", () => {
  it("never renders archived rows, even when the host forwards them unfiltered", () => {
    renderSidebar(ALL_SESSIONS);

    expect(screen.getByText("Live chat")).toBeInTheDocument();
    expect(screen.queryByText("Filed chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Steward filed chat")).not.toBeInTheDocument();
    // The Active/Archived toggle is gone — there is no path to these rows.
    expect(screen.queryByRole("button", { name: "Active" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archived" })).not.toBeInTheDocument();
  });

  it("never renders plugin-owned session IDs once the host filters with visibleChatSessions", () => {
    renderSidebar(visibleChatSessions(ALL_SESSIONS, new Set(["sh", "shx"])));

    expect(screen.getByText("Live chat")).toBeInTheDocument();
    expect(screen.queryByText("Steward chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Steward filed chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Filed chat")).not.toBeInTheDocument();
  });
});

describe("archiving from the sidebar", () => {
  it("archives a single session, which disappears once the host reflects it as archived", async () => {
    const user = userEvent.setup();
    const onArchiveSession = vi.fn();
    const liveOnly: SessionMeta[] = [{ id: "s1", title: "Live chat", createdAt: 1, updatedAt: 3 }];
    const { rerender, props } = renderSidebar(liveOnly, { onArchiveSession });

    const row = screen.getByText("Live chat").closest(".group") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));

    expect(onArchiveSession).toHaveBeenCalledWith("s1");

    // The host archives on its side and reflects the change back down —
    // Sidebar itself owns no archived state.
    rerender(
      <Sidebar
        {...props}
        sessions={[{ ...liveOnly[0], archived: true }]}
      />,
    );

    expect(screen.queryByText("Live chat")).not.toBeInTheDocument();
  });

  it("batch-archives the selected sessions", async () => {
    const user = userEvent.setup();
    const onArchiveSessions = vi.fn();
    renderSidebar(
      [
        { id: "s1", title: "Live chat", createdAt: 1, updatedAt: 3 },
        { id: "s2", title: "Other chat", createdAt: 1, updatedAt: 2 },
      ],
      { onArchiveSessions },
    );

    await user.click(screen.getByRole("button", { name: "More task actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Select tasks" }));

    await user.click(screen.getByText("Live chat"));
    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(onArchiveSessions).toHaveBeenCalledWith(["s1"]);
  });
});
