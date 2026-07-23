import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("0 9 * * *")).toBeInTheDocument();
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });

  it("keeps task lifecycle actions available in the workspace", async () => {
    render(<ScheduledTasksPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Trigger now" }),
    );

    expect(cronCore.triggerHermesCronJob).toHaveBeenCalledWith("daily-digest");
  });
});
