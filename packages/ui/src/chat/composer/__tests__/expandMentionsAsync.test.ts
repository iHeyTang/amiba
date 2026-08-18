import { describe, expect, it } from "vitest"

import { expandMentionsAsync } from "../expandMentions"
import { registerMentionType } from "../serialize"
import type { TriggerProvider } from "../providers/types"

describe("expandMentionsAsync", () => {
  it("resolves resource content at submission time", async () => {
    registerMentionType("test.resource", ["uri"])
    const provider: TriggerProvider = {
      trigger: "@",
      id: "test",
      ownsType: "test.resource",
      match: () => true,
      search: async () => [],
      onSelect: () => {},
      resolveMention: async (mention) => `<resource>${mention.payload.uri}:fresh</resource>`,
    }
    await expect(
      expandMentionsAsync("Use @[test.resource:doc%25one]", [provider]),
    ).resolves.toBe("Use <resource>doc%one:fresh</resource>")
  })

  it("marks a failed resource explicitly instead of treating the label as content", async () => {
    registerMentionType("broken.resource", ["uri"])
    const provider: TriggerProvider = {
      trigger: "@",
      id: "broken",
      ownsType: "broken.resource",
      match: () => true,
      search: async () => [],
      onSelect: () => {},
      resolveMention: async () => { throw new Error("gone") },
    }
    await expect(expandMentionsAsync("@[broken.resource:x]", [provider])).resolves.toContain(
      "Resource unavailable",
    )
  })
})
