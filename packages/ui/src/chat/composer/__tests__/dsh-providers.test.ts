import { beforeEach, describe, expect, it, vi } from "vitest"
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform"

import { makeSessionsProvider } from "../providers/sessions"
import { makeSkillsProvider } from "../providers/skills"
import { makeSlashProvider } from "../providers/slash"

const listSessions = vi.fn(async () => [
  {
    sessionId: "session-一",
    title: "认证重构",
    updatedAt: 10,
    running: false,
    blank: false,
  },
])
const listSkills = vi.fn(async () => ({
  userRoot: "/skills",
  skills: [
    { name: "security-review", description: "Review auth code", userInvocable: true, modelInvocable: true, editable: false },
  ],
}))
const listCommands = vi.fn(async () => [
  { name: "plan", description: "Enter plan mode", inputHint: "[message]" },
])

describe("DSH composer providers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPlatform({
      agentSessions: { list: listSessions },
      agentSkills: { list: listSkills },
      agentCommands: { list: listCommands },
    } as unknown as PlatformAdapter)
  })

  it("uses canonical DSH session-reference mentions", async () => {
    const provider = makeSessionsProvider()
    const item = (await provider.search("认证"))[0]
    expect(item.label).toBe("认证重构")
    const serialized = provider.serialize!(item.insert!)
    expect(serialized).toMatch(/^@\[认证重构\]\(dsh-session:[A-Za-z0-9_-]+\)$/u)
    const encoded = serialized.match(/dsh-session:([^\)]+)/u)?.[1] ?? ""
    const padded = encoded.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    expect(JSON.parse(new TextDecoder().decode(bytes))).toBe("session-一")
  })

  it("offers user-invocable DSH skills as slash gestures", async () => {
    const provider = makeSkillsProvider("session-一")
    expect(provider.trigger).toBe("/")
    const item = (await provider.search("security"))[0]
    expect(listSkills).toHaveBeenCalledWith("session-一")
    expect(provider.serialize!(item.insert!)).toBe("/security-review")
  })

  it("lists the exact scoped DSH command descriptors", async () => {
    const provider = makeSlashProvider("session-一")
    const item = (await provider.search("plan"))[0]
    expect(listCommands).toHaveBeenCalledWith("session-一")
    expect(item).toMatchObject({
      label: "plan",
      description: "Enter plan mode · [message]",
      raw: "/plan ",
    })
  })
})
