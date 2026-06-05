import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeSlashProvider } from "../providers/slash"

vi.mock("@hermes-x/core", () => ({
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
})
