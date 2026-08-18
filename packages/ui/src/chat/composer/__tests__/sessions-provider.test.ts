import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSessionsProvider } from "../providers/sessions"

vi.mock("@amiba/app-runtime/platform", () => ({
  getPlatform: () => ({
    agentSessions: {
      list: vi.fn().mockResolvedValue([
        { sessionId: "a1", title: "登录重构", updatedAt: 1 },
      ]),
    },
  }),
}))

describe("sessions provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns session mentions", async () => {
    const items = await makeSessionsProvider().search("登录")
    expect(items[0].insert).toEqual({ type: "session", payload: { id: "a1", title: "登录重构" }, display: "登录重构" })
  })
})
