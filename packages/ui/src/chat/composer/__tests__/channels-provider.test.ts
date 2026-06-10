import { describe, expect, it, vi, beforeEach } from "vitest"
import { makeChannelsProvider } from "../providers/channels"

vi.mock("@amiba/core", () => ({
  listChannels: () => [
    { id: "cli", fallbackLabel: "CLI", labelKey: "channel.cli", isLocal: true },
    { id: "telegram", fallbackLabel: "Telegram", labelKey: "channel.telegram", isLocal: false },
  ],
}))

describe("channels provider", () => {
  beforeEach(() => vi.clearAllMocks())
  it("returns channel mentions", async () => {
    const items = await makeChannelsProvider().search("tele")
    expect(items[0].insert).toEqual({ type: "channel", payload: { id: "telegram" }, display: "Telegram" })
  })
})
