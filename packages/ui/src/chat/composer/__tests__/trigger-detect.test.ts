import { describe, expect, it } from "vitest"
import { detectTrigger } from "../plugins/TriggerPlugin"

const plain = { tier: "plain" } as const

describe("detectTrigger (mirror of the official detector)", () => {
  it("detects @ anywhere with the query after it", () => {
    expect(detectTrigger("hello @tr", 9, plain)).toEqual({
      trigger: "@",
      query: "tr",
      position: "inline",
      span: { start: 6, end: 9, draftRev: 0 },
    })
  })
  it("detects a leading / and reports its position", () => {
    expect(detectTrigger("/mod", 4, plain)).toEqual({
      trigger: "/",
      query: "mod",
      position: "leading",
      span: { start: 0, end: 4, draftRev: 0 },
    })
    // Upstream is NOT line-anchored: a mid-line slash IS a hit, reported as
    // inline. Amiba's own `/` sources answer nothing for inline positions,
    // which is what keeps the built-ins' behaviour identical.
    expect(detectTrigger("hi /mod", 7, plain)?.position).toBe("inline")
  })
  it("closes when whitespace follows the trigger", () => {
    expect(detectTrigger("@skill done", 11, plain)).toBeNull()
  })
  it("returns null with no trigger", () => {
    expect(detectTrigger("plain text", 10, plain)).toBeNull()
  })
  it("keeps / dead inside URLs and after word chars", () => {
    expect(detectTrigger("https://x", 9, plain)).toBeNull()
    expect(detectTrigger("user@host", 9, plain)).toBeNull()
  })
  it("suppresses / but not @ while a command claim holds the input", () => {
    expect(detectTrigger("/mod", 4, { tier: "claimed" })).toBeNull()
    expect(detectTrigger("/goal @x", 8, { tier: "claimed" })?.trigger).toBe("@")
  })
  it("detects nothing at all while frozen", () => {
    expect(detectTrigger("@x", 2, { tier: "frozen" })).toBeNull()
  })
  it("stamps the caller's draft revision into the span", () => {
    expect(detectTrigger("@x", 2, plain, 7)?.span.draftRev).toBe(7)
  })
})
