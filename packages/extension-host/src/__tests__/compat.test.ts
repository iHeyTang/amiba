import { describe, expect, it } from "vitest"
import { checkCompat } from "../compat"

describe("checkCompat", () => {
  it("treats an absent required version as compatible", () => {
    expect(checkCompat(undefined, 1)).toEqual({ ok: true })
  })

  it("is compatible when required equals host", () => {
    expect(checkCompat(2, 2)).toEqual({ ok: true })
  })

  it("is compatible when required is below host", () => {
    expect(checkCompat(1, 3)).toEqual({ ok: true })
  })

  it("is incompatible when required exceeds host, with a reason citing both numbers", () => {
    const r = checkCompat(4, 2)
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.reason).toMatch(/\b4\b/)
    expect(r.ok ? "" : r.reason).toMatch(/\b2\b/)
  })
})
