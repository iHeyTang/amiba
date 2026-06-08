import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSessionsProvider } from "../providers/sessions"

vi.mock("@hermes-x/core", () => ({
  listHermesSessions: vi.fn().mockResolvedValue({
    sessions: [{ id: "a1", title: "登录重构", updated_at: "2026-06-01" }],
  }),
}))

describe("sessions provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns session mentions", async () => {
    const items = await makeSessionsProvider().search("登录")
    expect(items[0].insert).toEqual({ type: "session", payload: { id: "a1", title: "登录重构" }, display: "登录重构" })
  })
})
