import { describe, expect, it } from "vitest"

import { resolveChatSurfaceMode } from "../ChatSurface"

describe("resolveChatSurfaceMode", () => {
  it("uses the id-less state as home", () => {
    expect(resolveChatSurfaceMode("")).toBe("home")
  })

  it("keeps an existing empty conversation in conversation mode", () => {
    expect(resolveChatSurfaceMode("conversation-with-zero-messages")).toBe(
      "conversation",
    )
  })
})
