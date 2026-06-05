import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { getHermesCommands } from "../hermes-commands"

describe("getHermesCommands", () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { vi.restoreAllMocks() })

  it("returns commands on success", async () => {
    const body = [
      { name: "new", description: "Start a new session", category: "Session",
        aliases: ["reset"], args_hint: "[name]", subcommands: [] },
    ]
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body)))
    const res = await getHermesCommands()
    expect(res.ok).toBe(true)
    expect(res.commands[0].name).toBe("new")
    expect(res.commands[0].aliases).toEqual(["reset"])
  })

  it("returns ok=false on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 }))
    const res = await getHermesCommands()
    expect(res.ok).toBe(false)
    expect(res.commands).toEqual([])
  })

  it("returns ok=false on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("boom"))
    const res = await getHermesCommands()
    expect(res.ok).toBe(false)
  })
})
