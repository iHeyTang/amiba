import { describe, expect, it, vi, beforeEach } from "vitest"
import { makePersonasProvider } from "../providers/personas"

vi.mock("@amiba/core", () => ({
  getHermesPersonalities: vi.fn().mockResolvedValue({
    ok: true,
    personalities: [{ key: "concise", builtin: true, preview: "Keep it brief" }],
  }),
}))

describe("personas provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns persona mentions", async () => {
    const items = await makePersonasProvider().search("conc")
    expect(items[0].insert).toEqual({ type: "persona", payload: { key: "concise" }, display: "concise" })
  })
})
