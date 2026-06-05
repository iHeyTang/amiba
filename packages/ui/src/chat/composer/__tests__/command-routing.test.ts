import { describe, expect, it, vi } from "vitest"
import { routeSubmit } from "../command-routing"

describe("routeSubmit", () => {
  it("ui-action command triggers action, not send", () => {
    const send = vi.fn(); const openSettings = vi.fn()
    const handled = routeSubmit("/config", { send, ctx: { openSettings } })
    expect(handled).toBe(true)
    expect(openSettings).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it("send command goes to send as-is", () => {
    const send = vi.fn()
    const handled = routeSubmit("/model gpt-4", { send, ctx: {} })
    expect(handled).toBe(false) // not intercepted; caller sends finalText
  })
  it("non-command returns false", () => {
    const send = vi.fn()
    expect(routeSubmit("hello", { send, ctx: {} })).toBe(false)
  })
})
