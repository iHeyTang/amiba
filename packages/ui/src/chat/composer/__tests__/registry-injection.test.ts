import { describe, expect, it } from "vitest"
import { buildProviderRegistry } from "../providers/registry"
import type { TriggerProvider } from "../providers/types"

const files: TriggerProvider = {
  trigger: "@", id: "files", ownsType: "file",
  match: () => true, search: async () => [], onSelect: () => {},
}

describe("registry injection", () => {
  it("includes injected providers for @", () => {
    const reg = buildProviderRegistry([files])
    expect(reg.forTrigger("@").some((p) => p.id === "files")).toBe(true)
  })
})
