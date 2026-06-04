import { describe, expect, it } from "vitest"
import { validateManifest } from "../main/discover"

describe("validateManifest", () => {
  const base = {
    id: "io.hermes.example",
    name: "Example",
    version: "0.1.0",
    entries: { main: "dist/main.js" },
  }

  it("accepts a minimal valid manifest", () => {
    const r = validateManifest(base)
    expect(r.ok).toBe(true)
  })

  it("accepts a manifest with no entries (all optional)", () => {
    const r = validateManifest({ ...base, entries: {} })
    expect(r.ok).toBe(true)
  })

  it("rejects an id that is not reverse-DNS", () => {
    const r = validateManifest({ ...base, id: "knowledge-base" })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/id/)
  })

  it("rejects a non-semver version", () => {
    const r = validateManifest({ ...base, version: "v1" })
    expect(r.ok).toBe(false)
  })

  it("rejects sidebarView anchor that does not start with activityBar:", () => {
    const r = validateManifest({
      ...base,
      contributes: { sidebarViews: [{ id: "x", anchor: "main:y", view: "ui/sidebar.html" }] },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/anchor/)
  })

  it("accepts valid activityBar contributes with icon + labels", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        activityBar: [{ id: "panel", icon: "book-open", labels: { en: "Panel" } }],
      },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts valid sidebarView with view path", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        sidebarViews: [{ id: "sv", anchor: "activityBar:panel", view: "ui/sidebar.html" }],
      },
    })
    expect(r.ok).toBe(true)
  })
})
