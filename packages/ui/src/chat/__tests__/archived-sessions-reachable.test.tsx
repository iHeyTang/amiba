/**
 * Integration guard for the one bug the unit tests could not see: the sidebar
 * list is fed through `visibleChatSessions`, so if that helper drops archived
 * rows, `SessionsListView`'s own Active/Archived toggle never renders and an
 * archived session becomes unreachable for good (DSH has no unarchive yet).
 *
 * These tests therefore render the REAL `Sidebar` over the REAL helper output
 * rather than handing `SessionsListView` a pre-built `sessions` prop.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "../Sidebar";
import type { SessionMeta } from "@amiba/app-runtime/core";
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

function setup(onOpenSession = vi.fn()) {
  render(
    <Sidebar
      onNewChat={vi.fn()}
      sessions={visibleChatSessions(ALL_SESSIONS, new Set(["steward"]))}
      activeSessionId=""
      sessionsReady
      onOpenSession={onOpenSession}
      onRenameSession={vi.fn()}
      onRefreshSessions={vi.fn()}
      historyLayout="timeline"
      onHistoryLayoutChange={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
  return { onOpenSession };
}

describe("archived sessions stay reachable in the sidebar", () => {
  it("keeps archived rows out of the active view but shows them under the toggle", async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.getByText("Live chat")).toBeInTheDocument();
    expect(screen.queryByText("Filed chat")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived" }));

    expect(screen.getByText("Filed chat")).toBeInTheDocument();
    expect(screen.queryByText("Live chat")).not.toBeInTheDocument();
  });

  it("opens an archived session from the archived view", async () => {
    const user = userEvent.setup();
    const { onOpenSession } = setup();

    await user.click(screen.getByRole("button", { name: "Archived" }));
    await user.click(screen.getByText("Filed chat"));

    expect(onOpenSession).toHaveBeenCalledWith("s9");
  });

  it("shows hidden-preset sessions in neither view, archived or not", async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.queryByText("Steward chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Steward filed chat")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived" }));

    expect(screen.queryByText("Steward chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Steward filed chat")).not.toBeInTheDocument();
  });
});
