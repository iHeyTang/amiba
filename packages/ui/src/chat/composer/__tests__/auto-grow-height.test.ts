import { describe, expect, it } from "vitest"
import { measureIntrinsicHeight } from "../plugins/AutoGrowPlugin"

function editor({ bottom = 150, scrollTop = 0, height = 60, minHeight = 60 } = {}) {
  const root = document.createElement("div")
  root.style.cssText = `box-sizing:border-box;padding:10px 12px;min-height:${minHeight}px;height:${height}px;border:0`
  root.innerHTML = "<p>first</p><p>last</p>"
  root.getBoundingClientRect = () => new DOMRect(0, 100, 300, height)
  root.lastElementChild!.getBoundingClientRect = () => new DOMRect(12, 110, 276, bottom - 110)
  root.scrollTop = scrollTop
  return root
}

describe("composer intrinsic height", () => {
  it("uses the last paragraph, including root padding and its minimum height", () => {
    expect(measureIntrinsicHeight(editor({ bottom: 130 }))).toBe(60)
    expect(measureIntrinsicHeight(editor({ bottom: 210 }))).toBe(120)
  })

  it("measures overflowing content even when the capped editor has scrolled", () => {
    expect(measureIntrinsicHeight(editor({ bottom: 290, scrollTop: 180, height: 200 }))).toBe(380)
  })

  it("shrinks immediately after deletion without depending on the animated root height", () => {
    expect(measureIntrinsicHeight(editor({ bottom: 130, height: 200 }))).toBe(60)
    expect(measureIntrinsicHeight(editor({ bottom: 130, height: 100 }))).toBe(60)
  })

  it("excludes the root border from scroll-height coordinates", () => {
    const root = editor({ bottom: 154 })
    root.style.border = "4px solid black"
    expect(measureIntrinsicHeight(root)).toBe(60)
  })

  it("rounds fractional paragraph geometry up", () => {
    expect(measureIntrinsicHeight(editor({ bottom: 210.25 }))).toBe(121)
  })

  it("does not insert a measurement subtree into the live document", () => {
    const root = editor()
    document.body.append(root)
    const observer = new MutationObserver(() => {})
    observer.observe(document.body, { childList: true, subtree: true })
    measureIntrinsicHeight(root)
    expect(observer.takeRecords()).toEqual([])
    observer.disconnect()
    root.remove()
  })
})
