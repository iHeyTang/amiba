import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { uninstallPlugin } from "../hermes-plugins"
import { invalidateHermesCompatibilityCache } from "../backplane-client"

describe("uninstallPlugin", () => {
  beforeEach(() => {
    invalidateHermesCompatibilityCache()
    global.fetch = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns ok=true with appliesOnRestart on success", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: "0.19.0" }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, applies_on_restart: true })))
    const res = await uninstallPlugin("hermes-my-browser-extension")
    expect(res.ok).toBe(true)
    expect(res.appliesOnRestart).toBe(true)
  })

  it("surfaces backend error on non-2xx", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: "0.19.0" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "bundled plugin..." }), { status: 409 }),
      )
    const res = await uninstallPlugin("kanban")
    expect(res.ok).toBe(false)
    expect(res.error).toContain("bundled")
  })

  it("returns ok=false on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("boom"))
    const res = await uninstallPlugin("x")
    expect(res.ok).toBe(false)
  })
})
