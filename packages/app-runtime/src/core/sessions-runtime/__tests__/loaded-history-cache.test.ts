import { describe, expect, it } from "vitest"

import { createLoadedHistoryCache } from "../loaded-history-cache"

describe("createLoadedHistoryCache", () => {
  it("misses until an entry was stored", () => {
    const cache = createLoadedHistoryCache<string>(3)
    expect(cache.get("s1")).toBeUndefined()
    cache.set("s1", "messages")
    expect(cache.get("s1")).toBe("messages")
  })

  it("evicts the least recently used entry past the limit", () => {
    const cache = createLoadedHistoryCache<string>(2)
    cache.set("s1", "a")
    cache.set("s2", "b")
    cache.get("s1") // s1 becomes the most recently used
    cache.set("s3", "c")
    expect(cache.get("s2")).toBeUndefined()
    expect(cache.get("s1")).toBe("a")
    expect(cache.get("s3")).toBe("c")
    expect(cache.size()).toBe(2)
  })

  it("replaces an entry in place without growing", () => {
    const cache = createLoadedHistoryCache<string>(2)
    cache.set("s1", "a")
    cache.set("s1", "b")
    expect(cache.get("s1")).toBe("b")
    expect(cache.size()).toBe(1)
  })
})
