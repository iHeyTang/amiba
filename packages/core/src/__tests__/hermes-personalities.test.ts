import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { getHermesPersonalities } from "../hermes-personalities"

describe("getHermesPersonalities", () => {
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { vi.restoreAllMocks() })

  it("returns personalities on success", async () => {
    const body = [{ key: "helpful", builtin: true, preview: "You are a helpful" }]
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body)))
    const res = await getHermesPersonalities()
    expect(res.ok).toBe(true)
    expect(res.personalities[0].key).toBe("helpful")
  })

  it("returns ok=false on error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("x"))
    const res = await getHermesPersonalities()
    expect(res.ok).toBe(false)
    expect(res.personalities).toEqual([])
  })
})
