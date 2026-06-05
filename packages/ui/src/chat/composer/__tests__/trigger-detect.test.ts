import { describe, expect, it } from "vitest"
import { detectTrigger } from "../plugins/TriggerPlugin"

describe("detectTrigger", () => {
  it("detects @ anywhere with the query after it", () => {
    expect(detectTrigger("hello @tr", 9)).toEqual({ trigger: "@", query: "tr", start: 6 })
  })
  it("detects / only at line start", () => {
    expect(detectTrigger("/mod", 4)).toEqual({ trigger: "/", query: "mod", start: 0 })
    expect(detectTrigger("hi /mod", 7)).toBeNull() // not line start
  })
  it("closes when whitespace follows trigger", () => {
    expect(detectTrigger("@skill done", 11)).toBeNull()
  })
  it("returns null with no trigger", () => {
    expect(detectTrigger("plain text", 10)).toBeNull()
  })
  it("slash query spans whole line incl. spaces", () => {
    expect(detectTrigger("/reasoning lo", 13)).toEqual({ trigger: "/", query: "reasoning lo", start: 0 })
  })
})
