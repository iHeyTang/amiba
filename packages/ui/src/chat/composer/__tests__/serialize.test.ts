import { describe, expect, it } from "vitest"
import { encodeMention, parseTokens, registerMentionType } from "../serialize"
import type { MentionData } from "../providers/types"

const skill: MentionData = { type: "skill", payload: { name: "translate" }, display: "translate" }
const session: MentionData = { type: "session", payload: { id: "a1", title: "登录|重构" }, display: "登录|重构" }

describe("token serialize/parse", () => {
  it("encodes each type", () => {
    expect(encodeMention(skill)).toBe("@[skill:translate]")
    // pipe in title is escaped so parsing stays unambiguous
    expect(encodeMention(session)).toBe("@[session:a1|登录%7C重构]")
  })

  it("round-trips mixed text + mentions without losing chars", () => {
    const s = `hi ${encodeMention(skill)} mid ${encodeMention(session)} end`
    const parts = parseTokens(s)
    const rebuilt = parts
      .map((p) => (p.kind === "text" ? p.text : encodeMention(p.mention)))
      .join("")
    expect(rebuilt).toBe(s)
  })

  it("treats unknown @[...] as plain text", () => {
    const parts = parseTokens("see @[bogus:x] here")
    expect(parts.every((p) => p.kind === "text")).toBe(true)
    expect(parts.map((p) => (p.kind === "text" ? p.text : "")).join("")).toBe("see @[bogus:x] here")
  })

  it("round-trips a dynamic (dotted) registry type once registered", () => {
    // A provider plugin contributes "lark.doc" with fields [url, title].
    registerMentionType("lark.doc", ["url", "title"])
    const doc: MentionData = {
      type: "lark.doc",
      payload: { url: "https://x.feishu.cn/docx/a|b", title: "PRD" },
      display: "PRD",
    }
    // dot in the key + pipe in the url both survive
    const token = encodeMention(doc)
    expect(token).toBe("@[lark.doc:https://x.feishu.cn/docx/a%7Cb|PRD]")
    const parts = parseTokens(`pre ${token} post`)
    const mention = parts.find((p) => p.kind === "mention")
    expect(mention?.kind === "mention" && mention.mention.payload.url).toBe(
      "https://x.feishu.cn/docx/a|b",
    )
  })

  it("still treats a dotted key as plain text when NOT registered", () => {
    const parts = parseTokens("see @[unreg.type:x] here")
    expect(parts.every((p) => p.kind === "text")).toBe(true)
  })
})
