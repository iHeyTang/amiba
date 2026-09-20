import { describe, expect, it } from "vitest"

import { MESSAGE_TURN_WINDOW, windowTurns } from "../turn-window"

const turns = (count: number) => Array.from({ length: count }, (_, i) => `turn-${i}`)

describe("windowTurns", () => {
  it("keeps short histories whole", () => {
    const all = turns(3)
    const { visible, hidden } = windowTurns(all, MESSAGE_TURN_WINDOW)
    expect(visible).toBe(all)
    expect(hidden).toBe(0)
  })

  it("keeps the newest turns, in order, and reports what is folded", () => {
    const { visible, hidden } = windowTurns(turns(100), 24)
    expect(visible).toHaveLength(24)
    expect(visible[0]).toBe("turn-76")
    expect(visible[23]).toBe("turn-99")
    expect(hidden).toBe(76)
  })

  it("treats a limit below one as one turn rather than rendering nothing", () => {
    const { visible, hidden } = windowTurns(turns(5), 0)
    expect(visible).toEqual(["turn-4"])
    expect(hidden).toBe(4)
  })

  it("expands by whole slices until the history is whole again", () => {
    const all = turns(50)
    const first = windowTurns(all, MESSAGE_TURN_WINDOW)
    const second = windowTurns(all, MESSAGE_TURN_WINDOW + first.hidden)
    expect(second.hidden).toBe(0)
    expect(second.visible).toEqual(all)
  })
})
