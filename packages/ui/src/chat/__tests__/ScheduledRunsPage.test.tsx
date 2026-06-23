import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("../internal/useScheduledRuns", () => ({
  useScheduledRuns: () => ({
    runs: [
      {
        id: "cron_job1_1",
        title: "Jun 17, 09:00",
        createdAt: 1,
        updatedAt: 1,
        messageCount: 0,
        source: "job1",
      },
    ],
    ready: true,
    refresh: () => {},
    labelFor: () => "Daily digest",
    actionsFor: () => null,
    activeRunTitle: () => null,
  }),
}))

import { ScheduledRunsPage } from "../ScheduledRunsPage"

describe("ScheduledRunsPage", () => {
  it("renders cron-run rows and forwards open clicks", async () => {
    const onOpenRun = vi.fn()
    render(<ScheduledRunsPage query="" activeId="" onOpenRun={onOpenRun} />)
    const row = await screen.findByText("Jun 17, 09:00")
    await userEvent.click(row)
    expect(onOpenRun).toHaveBeenCalledWith("cron_job1_1")
  })

  it("shows the empty-detail placeholder when no detail is provided", async () => {
    render(<ScheduledRunsPage query="" activeId="" onOpenRun={vi.fn()} />)
    // List still renders alongside the placeholder (master/detail layout).
    expect(await screen.findByText("Jun 17, 09:00")).toBeInTheDocument()
    expect(
      screen.getByText("Select a run to view its output."),
    ).toBeInTheDocument()
  })

  it("renders the provided detail node instead of the placeholder", async () => {
    render(
      <ScheduledRunsPage
        query=""
        activeId="cron_job1_1"
        onOpenRun={vi.fn()}
        detail={<div>run-detail-content</div>}
      />,
    )
    expect(await screen.findByText("run-detail-content")).toBeInTheDocument()
    expect(
      screen.queryByText("Select a run to view its output."),
    ).not.toBeInTheDocument()
  })
})
