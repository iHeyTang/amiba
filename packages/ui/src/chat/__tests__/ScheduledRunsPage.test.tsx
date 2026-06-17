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
})
