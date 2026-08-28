import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshScheduledTasksPage } from "../DshScheduledTasksPage";

const list = vi.fn();

describe("DshScheduledTasksPage DSH reminders", () => {
  beforeEach(() => {
    list.mockImplementation(async (sessionId: string) =>
      sessionId === "session-1"
        ? [
            {
              id: "reminder-1",
              sessionId: "session-1",
              kind: "after",
              prompt: "Summarise the latest activity",
              scheduledAt: "2026-08-20T01:00:00.000Z",
              state: "scheduled",
              deliveryMode: "session-local",
              afterSeconds: 1800,
            },
          ]
        : [
            {
              id: "reminder-2",
              sessionId: "session-2",
              kind: "every",
              prompt: "Check project health",
              scheduledAt: "2026-08-20T02:00:00.000Z",
              state: "scheduled",
              deliveryMode: "session-local",
              everySeconds: 3600,
            },
          ],
    );
  });

  it("aggregates reminders without exposing session setup in the page", async () => {
    const user = userEvent.setup();
    render(
      <DshScheduledTasksPage
        activeSessionId="session-1"
        adapter={{ list, create: vi.fn(), remove: vi.fn() }}
        sessionsAdapter={{
          list: vi.fn().mockResolvedValue([
            {
              sessionId: "session-1",
              title: "Main session",
              createdAt: 1,
              updatedAt: 2,
              agentPreset: "standard",
            },
            {
              sessionId: "session-2",
              title: "Project session",
              createdAt: 1,
              updatedAt: 2,
              agentPreset: "standard",
            },
          ]),
        }}
      />,
    );
    expect(
      await screen.findByText("Summarise the latest activity"),
    ).toBeVisible();
    expect(screen.getByText("Check project health")).toBeVisible();
    expect(list).toHaveBeenCalledWith("session-1");
    expect(list).toHaveBeenCalledWith("session-2");
    expect(screen.getByText("Main session")).toBeVisible();
    expect(screen.getByText("Project session")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    // Creation is the agent's capability, exercised in conversation; this
    // surface is the read-only face of the official reminders, so no create
    // affordance exists here. Cron tasks — "start a fresh task on schedule" —
    // live in @amiba/dsh-plugin-cron.
    expect(
      screen.queryByRole("button", { name: "New reminder" }),
    ).not.toBeInTheDocument();
  });
});
