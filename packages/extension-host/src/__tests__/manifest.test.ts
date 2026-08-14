import { describe, expect, it } from "vitest"
import { validateManifest } from "../main/discover"

describe("validateManifest", () => {
  const base = {
    id: "io.amiba.example",
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

  // ---------------------------------------------------------------------------
  // contributes.main
  // ---------------------------------------------------------------------------

  it("accepts a valid contributes.main singleton", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        main: {
          icon: "book-open",
          labels: { en: "Knowledge Base", "zh-CN": "知识库" },
          view: "dist/ui/main/index.html",
          order: 200,
        },
      },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts contributes.main without order (optional)", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        main: {
          icon: "book-open",
          labels: { en: "Panel" },
          view: "dist/ui/main/index.html",
        },
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects contributes.main with missing icon", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        main: {
          labels: { en: "Panel" },
          view: "dist/ui/main/index.html",
        },
      },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/icon/)
  })

  it("rejects contributes.main with empty labels", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        main: {
          icon: "book-open",
          labels: {},
          view: "dist/ui/main/index.html",
        },
      },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/labels/)
  })

  it("rejects contributes.main with missing view", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        main: {
          icon: "book-open",
          labels: { en: "Panel" },
        },
      },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/view/)
  })

  // ---------------------------------------------------------------------------
  // contributes.settings
  // ---------------------------------------------------------------------------

  it("accepts a valid contributes.settings singleton", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        settings: {
          icon: "book-open",
          labels: { en: "Knowledge Base", "zh-CN": "知识库" },
          view: "dist/ui/settings/index.html",
          order: 100,
        },
      },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts contributes.settings without icon (optional)", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        settings: {
          labels: { en: "My Extension" },
          view: "dist/ui/settings/index.html",
        },
      },
    })
    expect(r.ok).toBe(true)
  })

  it("rejects contributes.settings with empty labels", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        settings: {
          labels: {},
          view: "dist/ui/settings/index.html",
        },
      },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/labels/)
  })

  it("rejects contributes.settings with missing view", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        settings: {
          labels: { en: "My Extension" },
        },
      },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/view/)
  })

  it("accepts both main and settings contributions together", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        main: {
          icon: "book-open",
          labels: { en: "Knowledge Base" },
          view: "dist/ui/main/index.html",
          order: 200,
        },
        settings: {
          icon: "book-open",
          labels: { en: "Knowledge Base" },
          view: "dist/ui/settings/index.html",
          order: 100,
        },
      },
    })
    expect(r.ok).toBe(true)
  })

  it("accepts a manifest with neither main nor settings (pure background)", () => {
    const r = validateManifest({ ...base, contributes: {} })
    expect(r.ok).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // mentions (Extension-owned Composer capabilities)
  // ---------------------------------------------------------------------------

  it("accepts an Extension-owned mention contribution", () => {
    const r = validateManifest({
      ...base,
      mentions: [
        {
          id: "documents",
          provider: "default",
          label: "Documents",
          resourceUriTemplate: "doc://library/{id}",
          searchTool: "search-documents",
        },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it("rejects a mention without a resource projection or search tool", () => {
    const r = validateManifest({
      ...base,
      mentions: [{ id: "documents", provider: "default", label: "Documents" }],
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/resourceUriTemplate|searchTool/)
  })

  it("rejects duplicate mention ids within one Extension", () => {
    const mention = {
      id: "documents",
      provider: "default",
      label: "Documents",
      searchTool: "search-documents",
    }
    const r = validateManifest({ ...base, mentions: [mention, mention] })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/duplicate/)
  })

  it("accepts Hermes Plugin dependencies contributed by an Extension", () => {
    const r = validateManifest({
      ...base,
      hermesPlugins: [{ id: "web_search", version: ">=1.2.0", required: true }],
    })
    expect(r.ok).toBe(true)
  })

  it("rejects duplicate Hermes Plugin dependencies", () => {
    const r = validateManifest({
      ...base,
      hermesPlugins: [{ id: "web_search" }, { id: "web_search" }],
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/duplicate/)
  })

  // ---------------------------------------------------------------------------
  // apiVersion (minimum host API level)
  // ---------------------------------------------------------------------------

  it("accepts a manifest with an integer apiVersion", () => {
    expect(validateManifest({ ...base, apiVersion: 2 }).ok).toBe(true)
  })

  it("accepts apiVersion 1 (minimum valid value)", () => {
    expect(validateManifest({ ...base, apiVersion: 1 }).ok).toBe(true)
  })

  it("accepts a manifest without apiVersion (optional)", () => {
    expect(validateManifest(base).ok).toBe(true)
  })

  it("rejects apiVersion 0", () => {
    const r = validateManifest({ ...base, apiVersion: 0 })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/apiVersion/)
  })

  it("rejects a non-integer apiVersion", () => {
    const r = validateManifest({ ...base, apiVersion: 1.5 })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/apiVersion/)
  })

  it("rejects a string apiVersion", () => {
    const r = validateManifest({ ...base, apiVersion: "2" })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/apiVersion/)
  })
})
