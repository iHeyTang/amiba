import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

import {
  ACCENTS,
  DEFAULT_ACCENT_PREFERENCE,
  applyAccentClass,
  loadAccentPreference,
  normalizeStoredAccent,
  type AccentPreference,
} from "../index"

describe("normalizeStoredAccent", () => {
  it("passes through every known accent id", () => {
    for (const { id } of ACCENTS) {
      expect(normalizeStoredAccent(id)).toBe(id)
    }
  })

  it("falls back to the default for unknown / empty values", () => {
    for (const bad of [undefined, null, "", "blue", 42, {}, "AUTO"]) {
      expect(normalizeStoredAccent(bad)).toBe(DEFAULT_ACCENT_PREFERENCE)
    }
  })
})

describe("ACCENTS registry", () => {
  it("contains the default accent", () => {
    expect(ACCENTS.map((a) => a.id)).toContain(DEFAULT_ACCENT_PREFERENCE)
  })

  it("has unique ids and a swatch colour for each", () => {
    const ids = ACCENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACCENTS) {
      expect(a.swatch).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

describe("applyAccentClass", () => {
  afterEach(() => {
    document.documentElement.className = ""
  })

  it("adds the matching accent-<id> class", () => {
    applyAccentClass("coral")
    expect(document.documentElement.classList.contains("accent-coral")).toBe(true)
  })

  it("removes the previously applied accent when switching", () => {
    applyAccentClass("violet")
    applyAccentClass("cyan")
    expect(document.documentElement.classList.contains("accent-violet")).toBe(false)
    expect(document.documentElement.classList.contains("accent-cyan")).toBe(true)
  })

  it("leaves unrelated classes (dark/light) untouched", () => {
    document.documentElement.classList.add("dark")
    applyAccentClass("lime")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.classList.contains("accent-lime")).toBe(true)
  })
})

describe("accent token cascade (regression)", () => {
  // The base theme block is `.light, :root.light { --primary … }`, so for an
  // <html class="light accent-x"> element the winning base selector is
  // `:root.light` (specificity 0,2,0) — and Tailwind emits it AFTER our
  // appended accent rules. A bare `.accent-x` (0,1,0) therefore loses and the
  // accent never takes effect. Each accent must out-specify the base by being
  // qualified with BOTH `:root` and the active theme class (0,3,0).
  const here = dirname(fileURLToPath(import.meta.url))
  const tokensCss = readFileSync(
    resolve(here, "../../styles/tokens.css"),
    "utf8",
  )
  const presetCss = readFileSync(
    resolve(here, "../../../../tailwind-preset/styles/tokens.css"),
    "utf8",
  )

  it("qualifies every accent with :root + theme class for light AND dark", () => {
    for (const css of [tokensCss, presetCss]) {
      for (const { id } of ACCENTS) {
        expect(css).toContain(`:root.light.accent-${id}`)
        expect(css).toContain(`:root.dark.accent-${id}`)
      }
    }
  })

  it("has no bare `.accent-*` brand rule that the base would override", () => {
    for (const css of [tokensCss, presetCss]) {
      expect(css).not.toMatch(/^\s*\.accent-/m)
      expect(css).not.toMatch(/^\s*\.dark\.accent-/m)
    }
  })
})

describe("loadAccentPreference", () => {
  it("returns the default when storage holds nothing", async () => {
    // The test harness installs an empty in-memory platform (see test/setup.ts),
    // so an unset key resolves to the default accent.
    const pref: AccentPreference = await loadAccentPreference()
    expect(pref).toBe(DEFAULT_ACCENT_PREFERENCE)
  })
})
