import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@amiba/core", () => ({
  useCronSessions: () => ({
    sessions: [
      {
        id: "cron_job1_1700000000",
        started_at: 1700000000,
        last_active: 1700000100,
        message_count: 2,
      },
    ],
    ready: true,
    refresh: () => {},
  }),
  getHermesCronJobs: vi.fn(async () => ({
    ok: true,
    jobs: [{ id: "job1", name: "Daily digest" }],
  })),
  triggerHermesCronJob: vi.fn(async () => ({ ok: true })),
  parseCronSessionJobId: (id: string) => id.split("_")[1] ?? null,
}))

import { useScheduledRuns } from "../internal/useScheduledRuns"

describe("useScheduledRuns", () => {
  it("maps cron sessions to SessionMeta keyed by jobId and titles the active run", async () => {
    const { result } = renderHook(() => useScheduledRuns())
    expect(result.current.runs).toHaveLength(1)
    expect(result.current.runs[0].source).toBe("job1")
    expect(result.current.runs[0].id).toBe("cron_job1_1700000000")
    await waitFor(() => expect(result.current.labelFor("job1")).toBe("Daily digest"))
    const title = result.current.activeRunTitle("cron_job1_1700000000")
    expect(title).toContain("Daily digest")
    expect(result.current.activeRunTitle("nope")).toBeNull()
  })
})
