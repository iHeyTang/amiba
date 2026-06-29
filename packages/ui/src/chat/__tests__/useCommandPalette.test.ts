import { act, renderHook } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useCommandPalette } from "../useCommandPalette"

describe("useCommandPalette", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useCommandPalette())
    expect(result.current.open).toBe(false)
  })

  it("toggles open on Cmd/Ctrl+K", () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true })
    })
    expect(result.current.open).toBe(true)
    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true })
    })
    expect(result.current.open).toBe(false)
  })

  it("ignores a plain k", () => {
    const { result } = renderHook(() => useCommandPalette())
    act(() => {
      fireEvent.keyDown(window, { key: "k" })
    })
    expect(result.current.open).toBe(false)
  })
})
