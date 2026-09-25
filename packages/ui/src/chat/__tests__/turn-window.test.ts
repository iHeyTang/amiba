import { describe, expect, it } from "vitest"

import {
  MESSAGE_DOM_CAP,
  MESSAGE_TURN_WINDOW,
  windowTurns,
} from "../turn-window"

const turns = (count: number) => Array.from({ length: count }, (_, i) => `turn-${i}`)

// A turn whose size emulates a tool-heavy DSH turn (one assistant message per
// tool step), the shape `MessageTurns` feeds the window.
const sizedTurns = (sizes: number[]) =>
  sizes.map((size, i) => ({
    id: i,
    messages: Array.from({ length: size }, (_, j) => `m-${i}-${j}`),
  }))

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

  it("bounds the mounted messages when few heavy turns exceed the cap", () => {
    // 19 turns × ~40 replies each — ~780 messages, all inside the turn window
    // (19 < 24), so only the message cap can bound the DOM.
    const heavy = sizedTurns(Array.from({ length: 19 }, () => 40))
    const { visible, hidden } = windowTurns(heavy, MESSAGE_TURN_WINDOW, {
      maxMessages: MESSAGE_DOM_CAP,
      countMessages: (turn) => turn.messages.length,
    })
    const mounted = visible.reduce((sum, turn) => sum + turn.messages.length, 0)
    expect(mounted).toBeLessThanOrEqual(MESSAGE_DOM_CAP)
    expect(mounted).toBeGreaterThan(MESSAGE_DOM_CAP - 40) // the newest slice is kept as full as possible
    expect(hidden).toBeGreaterThan(0)
    expect(visible.at(-1)).toBe(heavy.at(-1)) // the newest turn is always kept
  })

  it("never folds below the newest turn, even when one turn alone exceeds the cap", () => {
    const oversized = sizedTurns([500, 50])
    const { visible, hidden } = windowTurns(oversized, MESSAGE_TURN_WINDOW, {
      maxMessages: MESSAGE_DOM_CAP,
      countMessages: (turn) => turn.messages.length,
    })
    expect(visible).toEqual([oversized[1]])
    expect(hidden).toBe(1)
  })

  it("keeps the turn limit authoritative when the cap does not bind", () => {
    const many = sizedTurns(Array.from({ length: 100 }, () => 1))
    const { visible, hidden } = windowTurns(many, 24, {
      maxMessages: MESSAGE_DOM_CAP,
      countMessages: (turn) => turn.messages.length,
    })
    expect(visible).toHaveLength(24)
    expect(hidden).toBe(76)
  })

  it("applies the stricter of the turn limit and the message cap", () => {
    const mixed = sizedTurns([...Array.from({ length: 50 }, () => 1), 200, 200])
    const { visible } = windowTurns(mixed, 24, {
      maxMessages: MESSAGE_DOM_CAP,
      countMessages: (turn) => turn.messages.length,
    })
    // The 200-message turns pin the cap: only the newest turn fits.
    expect(visible).toEqual([mixed.at(-1)])
  })
})