import { describe, expect, it, vi } from "vitest"
import { createSlotRegistry } from "../renderer/slot-registry"

describe("SlotRegistry", () => {
  it("returns entries sorted by order ascending", () => {
    const reg = createSlotRegistry()
    reg.register("activityBar.item", {
      extensionId: "a", entryId: "x", order: 20, component: () => null,
    })
    reg.register("activityBar.item", {
      extensionId: "b", entryId: "y", order: 10, component: () => null,
    })
    const ids = reg.get("activityBar.item").map((e) => e.entryId)
    expect(ids).toEqual(["y", "x"])
  })

  it("disposing a registration removes it from subsequent reads", () => {
    const reg = createSlotRegistry()
    const d = reg.register("activityBar.item", {
      extensionId: "a", entryId: "x", order: 0, component: () => null,
    })
    expect(reg.get("activityBar.item")).toHaveLength(1)
    d.dispose()
    expect(reg.get("activityBar.item")).toHaveLength(0)
  })

  it("notifies subscribers on register / dispose", () => {
    const reg = createSlotRegistry()
    const cb = vi.fn()
    reg.subscribe(cb)
    const d = reg.register("activityBar.item", {
      extensionId: "a", entryId: "x", order: 0, component: () => null,
    })
    expect(cb).toHaveBeenCalledTimes(1)
    d.dispose()
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
