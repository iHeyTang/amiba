import { beforeEach, describe, expect, it, vi } from "vitest"
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform"

import {
  COMMAND_SOURCE,
  SESSION_SOURCE,
  SKILL_SOURCE,
  localReferenceResolver,
  localTriggerSources,
  makeCommandSource,
  makeSessionSource,
  makeSkillSource,
  officialTriggerSources,
} from "../providers/dsh-sources"
import type { InputTriggerCandidate } from "../triggers/contracts"

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
    {
      name: "security-review",
      description: "Review auth code",
      userInvocable: true,
      modelInvocable: true,
      editable: false,
    },
  ],
}))
const listCommands = vi.fn(async () => [
  { name: "plan", description: "Enter plan mode", inputHint: "[message]" },
])

const session = { sessionId: "session-一" } as never
const request = (query: string, position: "leading" | "inline" = "leading") => ({
  query,
  position,
  signal: new AbortController().signal,
})
const pick = (candidate: InputTriggerCandidate) => ({
  candidate,
  session,
  position: "leading" as const,
  via: "menu" as const,
  span: { start: 0, end: 1, draftRev: 0 },
})

describe("Amiba's official trigger sources", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPlatform({
      agentSessions: { list: listSessions },
      agentSkills: { list: listSkills },
      agentCommands: { list: listCommands },
    } as unknown as PlatformAdapter)
  })

  it("offers user-invocable DSH skills and serializes them back to /name", async () => {
    const source = makeSkillSource()
    expect(source.trigger).toBe("/")
    expect(source.name).toBe(SKILL_SOURCE)
    const [candidate] = await source.candidates(session, request("security"))
    expect(listSkills).toHaveBeenCalledWith("session-一")
    expect(candidate.name).toBe("security-review")
    const outcome = source.onPick(pick(candidate))
    expect(outcome).toEqual({
      insert: {
        source: SKILL_SOURCE,
        ref: "security-review",
        label: "security-review",
        clipboardText: "/security-review",
      },
    })
    await expect(
      source.codec!.serialize("security-review", new AbortController().signal),
    ).resolves.toBe("/security-review")
  })

  it("keeps the built-in slash sources leading-only", async () => {
    // Pre-adoption Amiba anchored `/` to the start of the line; the official
    // detector is not line-anchored, so the sources carry the policy.
    await expect(
      makeSkillSource().candidates(session, request("security", "inline")),
    ).resolves.toEqual([])
    await expect(
      makeCommandSource().candidates(session, request("plan", "inline")),
    ).resolves.toEqual([])
  })

  it("closes skill completion once slash arguments begin", async () => {
    await expect(
      makeSkillSource().candidates(session, request("security review")),
    ).resolves.toEqual([])
  })

  it("uses canonical DSH session-reference mentions", async () => {
    const source = makeSessionSource()
    const [candidate] = await source.candidates(session, request("认证"))
    expect(candidate.name).toBe("认证重构")
    const outcome = source.onPick(pick(candidate))
    expect(outcome).toEqual({
      insert: {
        source: SESSION_SOURCE,
        ref: "session-一",
        label: "认证重构",
        clipboardText: "@认证重构",
      },
    })
    const serialized = await source.codec!.serialize(
      "session-一",
      new AbortController().signal,
    )
    expect(serialized).toMatch(/^@\[认证重构\]\(dsh-session:[A-Za-z0-9_-]+\)$/u)
    const encoded = serialized.match(/dsh-session:([^)]+)/u)?.[1] ?? ""
    const padded = encoded
      .replace(/-/gu, "+")
      .replace(/_/gu, "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=")
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
    expect(JSON.parse(new TextDecoder().decode(bytes))).toBe("session-一")
  })

  it("lists the exact scoped DSH command descriptors as a plain-text pick", async () => {
    const source = makeCommandSource("session-一")
    const [candidate] = await source.candidates(session, request("plan"))
    expect(listCommands).toHaveBeenCalledWith("session-一")
    expect(candidate).toEqual({
      name: "plan",
      description: "Enter plan mode · [message]",
    })
    expect(source.onPick(pick(candidate))).toEqual({ text: "/plan " })
  })

  it("registers no `command` source with the official service", () => {
    // `ui-commands` owns ('/', "command") in-session: registering both would
    // throw on the service's uniqueness rule and show two identical groups.
    expect(officialTriggerSources().map((source) => source.name)).toEqual([
      SKILL_SOURCE,
      SESSION_SOURCE,
    ])
    expect(localTriggerSources().map((source) => source.name)).toContain(
      COMMAND_SOURCE,
    )
  })

  it("rejects rather than downgrading when no codec owns a reference", async () => {
    const resolver = localReferenceResolver(localTriggerSources())
    await expect(
      resolver.serializeReference(
        COMMAND_SOURCE,
        "plan",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no serializer/u)
    await expect(
      resolver.serializeReference(
        "nope",
        "x",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no serializer/u)
  })
})
