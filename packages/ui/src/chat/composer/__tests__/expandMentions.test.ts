import { describe, expect, it } from "vitest"
import { expandMentions } from "../expandMentions"
import type { MentionData, TriggerProvider } from "../providers/types"

const skills = {
  trigger: "@", id: "skills", ownsType: "skill",
  match: () => true, search: async () => [], onSelect: () => {},
  serialize: (m: MentionData) => `(skill: ${m.payload.name})`,
} as unknown as TriggerProvider

describe("expandMentions", () => {
  it("replaces tokens via provider.serialize, keeps plain text", () => {
    const out = expandMentions("hi @[skill:translate] there", [skills])
    expect(out).toBe("hi (skill: translate) there")
  })
  it("leaves text untouched when no provider serializes a type", () => {
    const out = expandMentions("x @[persona:concise] y", [skills])
    expect(out).toContain("@[persona:concise]") // unhandled -> raw kept
  })
})
