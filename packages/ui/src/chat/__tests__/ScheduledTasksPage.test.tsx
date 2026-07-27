import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cronCore = vi.hoisted(() => ({
  createHermesCronJob: vi.fn(async () => ({ ok: true })),
  deleteHermesCronJob: vi.fn(async () => ({ ok: true })),
  getHermesCronJobs: vi.fn(),
  pauseHermesCronJob: vi.fn(async () => ({ ok: true })),
  resumeHermesCronJob: vi.fn(async () => ({ ok: true })),
  triggerHermesCronJob: vi.fn(async () => ({ ok: true })),
  updateHermesCronJob: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@amiba/core", () => cronCore);

import { ScheduledTasksPage } from "../ScheduledTasksPage";

const registeredJob = {
  id: "daily-digest",
  name: "Daily digest",
  prompt: "Summarise the latest activity",
  skills: [],
  skill: null,
  model: null,
  provider: null,
  base_url: null,
  script: null,
  no_agent: false,
  context_from: null,
  schedule: { kind: "cron" },
  schedule_display: "0 9 * * *",
  repeat: { times: null, completed: 0 },
  enabled: true,
  state: "scheduled",
  paused_at: null,
  paused_reason: null,
  created_at: "2026-07-23T00:00:00Z",
  next_run_at: "2026-07-24T01:00:00Z",
  last_run_at: null,
  last_status: null,
  last_error: null,
  last_delivery_error: null,
  deliver: "local",
  origin: null,
  enabled_toolsets: null,
  workdir: null,
};

const pausedJob = {
  ...registeredJob,
  id: "weekly-review",
  name: "Weekly review",
  prompt: "Review the week",
  schedule_display: "0 16 * * 5",
  enabled: false,
  state: "paused",
};

describe("ScheduledTasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cronCore.getHermesCronJobs.mockResolvedValue({
      ok: true,
      jobs: [registeredJob],
    });
  });

  it("shows registered jobs instead of cron-run history", async () => {
    render(<ScheduledTasksPage />);

    expect(await screen.findByText("Daily digest")).toBeInTheDocument();
    expect(screen.getByText("Daily at 09:00")).toBeInTheDocument();
    expect(
      screen.queryByText("Summarise the latest activity"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("daily-digest")).not.toBeInTheDocument();
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Never run")).not.toBeInTheDocument();
  });

  it("keeps task lifecycle actions available in the workspace", async () => {
    render(<ScheduledTasksPage />);

    expect(
      await screen.findByText("Daily digest"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run now" }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", {
        name: "More actions for Daily digest",
      }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Run now" }));

    expect(cronCore.triggerHermesCronJob).toHaveBeenCalledWith("daily-digest");
  });

  it("moves secondary actions into an accessible more menu", async () => {
    render(<ScheduledTasksPage />);

    await userEvent.click(
      await screen.findByRole("button", {
        name: "More actions for Daily digest",
      }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Edit task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy task ID" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete task" }),
    ).toBeInTheDocument();
  });

  it("uses the row switch to pause an enabled task", async () => {
    render(<ScheduledTasksPage />);

    await userEvent.click(
      await screen.findByRole("switch", { name: "Pause Daily digest" }),
    );

    expect(cronCore.pauseHermesCronJob).toHaveBeenCalledWith("daily-digest");
  });

  it("searches tasks and filters them by lifecycle state", async () => {
    cronCore.getHermesCronJobs.mockResolvedValue({
      ok: true,
      jobs: [registeredJob, pausedJob],
    });
    render(<ScheduledTasksPage />);

    const search = await screen.findByRole("searchbox", {
      name: "Search scheduled tasks",
    });
    await userEvent.type(search, "weekly");

    expect(screen.queryByText("Daily digest")).not.toBeInTheDocument();
    expect(screen.getByText("Weekly review")).toBeInTheDocument();

    await userEvent.clear(search);

    const enabledRow = screen.getByText("Daily digest").closest("li");
    const pausedRow = screen.getByText("Weekly review").closest("li");
    expect(enabledRow).not.toBeNull();
    expect(pausedRow).not.toBeNull();
    expect(within(enabledRow!).getByText(/^Next /)).toBeInTheDocument();
    expect(within(pausedRow!).getByText("Paused")).toBeInTheDocument();
    expect(within(pausedRow!).queryByText(/^Next /)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Paused" }));

    expect(screen.queryByText("Daily digest")).not.toBeInTheDocument();
    expect(screen.getByText("Weekly review")).toBeInTheDocument();
  });
});
