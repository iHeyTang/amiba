// packages/extension-host/src/__tests__/i18n-merge.test.ts
import { describe, expect, it } from "vitest"
import { prefixTable, mergeExtensionTables } from "../renderer/i18n-merge"

describe("prefixTable", () => {
  it("prepends ext.<id>. to every key", () => {
    const out = prefixTable("io.foo.bar", { "label": "X" })
    expect(out).toEqual({ "ext.io.foo.bar.label": "X" })
  })
})

describe("mergeExtensionTables", () => {
  it("merges multiple extensions without clobbering core keys", () => {
    const result = mergeExtensionTables({
      core: { "core.key": "Core" },
      perExtension: {
        "io.a.one": { "x": "X" },
        "io.b.two": { "y": "Y" },
      },
    })
    expect(result).toEqual({
      "core.key": "Core",
      "ext.io.a.one.x": "X",
      "ext.io.b.two.y": "Y",
    })
  })
})
