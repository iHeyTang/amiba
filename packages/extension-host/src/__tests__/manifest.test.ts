import { describe, expect, it } from "vitest"
import { validateManifest } from "../main/discover"
import { discoverRendererExtensions } from "../renderer/discover"

describe("validateManifest", () => {
  const base = {
    id: "io.hermes.example",
    name: "Example",
    version: "0.1.0",
    entries: { renderer: "dist/renderer.js" },
  }

  it("accepts a minimal valid manifest", () => {
    const r = validateManifest(base)
    expect(r.ok).toBe(true)
  })

  it("rejects an id that is not reverse-DNS", () => {
    const r = validateManifest({ ...base, id: "knowledge-base" })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/id/)
  })

  it("rejects when both entries are missing", () => {
    const r = validateManifest({ ...base, entries: {} })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/entries/)
  })

  it("rejects a non-semver version", () => {
    const r = validateManifest({ ...base, version: "v1" })
    expect(r.ok).toBe(false)
  })

  it("rejects sidebarView anchor that does not start with activityBar:", () => {
    const r = validateManifest({
      ...base,
      contributes: { sidebarViews: [{ id: "x", anchor: "main:y" }] },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/anchor/)
  })
})

describe("discoverRendererExtensions", () => {
  it("matches renderer + i18n to a manifest by directory id", async () => {
    const r = await discoverRendererExtensions({
      manifestModules: {
        "/r/packages/extensions/kb/manifest.json": async () => ({
          default: {
            id: "io.hermes.knowledge-base",
            name: "KB",
            version: "0.1.0",
            entries: { renderer: "dist/renderer.js" },
          },
        }),
      },
      rendererModules: {
        "/r/packages/extensions/kb/dist/renderer.js": async () => ({
          activate: () => undefined,
        }),
      },
      i18nModules: {
        "/r/packages/extensions/kb/dist/i18n/en.json": async () => ({
          default: { hello: "Hello" },
        }),
      },
    })
    expect(r.failed).toEqual([])
    expect(r.extensions).toHaveLength(1)
    const en = await r.extensions[0]!.loadI18n("en")
    expect(en).toEqual({ hello: "Hello" })
  })
})
