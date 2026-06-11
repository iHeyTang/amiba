import { describe, expect, it } from "vitest"
import type { MentionResource } from "@amiba/core"
import { makeMentionResourceProvider } from "../providers/mention-resources"
import type { MentionData } from "../providers/types"

/**
 * The reference line sent to the agent is owned by the host, not the source:
 * `(<label>: <name> · <handle…>)`. The source only declares `label` + `fields`,
 * so every external mention serializes identically.
 */
function entry(over: Partial<MentionResource>): MentionResource {
  return {
    key: "x.t",
    integration: "x",
    type: "t",
    label: "L",
    trigger: "@",
    fields: [],
    search: "/s",
    group: "G",
    ...over,
  }
}

describe("mention-resource serialize (host-owned format)", () => {
  it("formats as (label: name · handle), name first then the other fields", () => {
    const doc = makeMentionResourceProvider(
      entry({ key: "lark.doc", label: "飞书文档", fields: ["url", "title"] }),
    )
    const m: MentionData = {
      type: "lark.doc",
      display: "季度规划",
      payload: { url: "https://qima.feishu.cn/wiki/x", title: "季度规划" },
    }
    expect(doc.serialize?.(m)).toBe("(飞书文档: 季度规划 · https://qima.feishu.cn/wiki/x)")
  })

  it("is uniform across sources/types — only label and field values differ", () => {
    const chat = makeMentionResourceProvider(
      entry({ key: "lark.chat", label: "飞书群", fields: ["chat_id", "name"] }),
    )
    const out = chat.serialize?.({
      type: "lark.chat",
      display: "发布群",
      payload: { chat_id: "oc_abc", name: "发布群" },
    })
    expect(out).toBe("(飞书群: 发布群 · oc_abc)")
  })
})
