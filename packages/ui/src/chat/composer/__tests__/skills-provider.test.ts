import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSkillsProvider } from "../providers/skills"

vi.mock("@amiba/core", () => ({
  getHermesSkills: vi.fn().mockResolvedValue({
    ok: true,
    skills: [
      { name: "translate", description: "Translate text", enabled: true },
      { name: "summarize", description: "Summarize", enabled: true },
    ],
  }),
}))

describe("skills provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("searches by query and returns MenuItems with skill mentions", async () => {
    const p = makeSkillsProvider()
    const items = await p.search("trans")
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe("translate")
    expect(items[0].insert).toEqual({ type: "skill", payload: { name: "translate" }, display: "translate" })
  })
  it("serializes a skill mention for sending", () => {
    const p = makeSkillsProvider()
    expect(p.serialize?.({ type: "skill", payload: { name: "translate" }, display: "translate" }))
      .toContain("translate")
  })
})
