import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSlashProvider } from "../providers/slash"

vi.mock("@amiba/core", () => ({
  getHermesCommands: vi.fn().mockResolvedValue({
    ok: true,
    commands: [
      { name: "model", description: "Switch model", category: "Configuration", aliases: ["provider"], args_hint: "[model]", subcommands: [] },
      { name: "reasoning", description: "Effort", category: "Configuration", aliases: [], args_hint: "[level]", subcommands: ["low", "high"] },
    ],
  }),
}))

describe("slash provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("lists commands matching query, including alias match", async () => {
    const p = makeSlashProvider()
    const items = await p.search("prov")
    expect(items.some((i) => i.label === "model")).toBe(true)
  })
  it("exposes subcommands for two-level completion", async () => {
    const p = makeSlashProvider()
    const items = await p.search("reasoning")
    const reasoning = items.find((i) => i.label === "reasoning")
    expect(reasoning?.subcommands).toEqual(["low", "high"])
  })
  it("offers subcommand items when query has 'cmd sub'", async () => {
    const p = makeSlashProvider()
    const items = await p.search("reasoning hi")
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe("high")
    expect(items[0].raw).toBe("/reasoning high ")
  })
  it("returns empty for a command without subcommands at second level", async () => {
    const p = makeSlashProvider()
    expect(await p.search("model foo")).toEqual([])
  })
})
