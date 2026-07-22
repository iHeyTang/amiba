import { describe, expect, it, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { seedBundledExtensions } from "../main/seed-bundled"
import { addEntry, findEntry, loadRegistry, type RegistryEntry } from "../main/registry-store"

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "seed-bundled-test-"))
}

/** Create an extension root dir with a minimal manifest.json. */
function makeExtRoot(base: string, id: string, version = "0.1.0"): string {
  const root = join(base, id)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ id, version }))
  return root
}

describe("seedBundledExtensions", () => {
  const tmps: string[] = []
  afterEach(() => {
    for (const t of tmps) {
      try {
        rmSync(t, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    tmps.length = 0
  })

  it("seeds a missing bundled extension", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "registry.json")
    const extRoot = makeExtRoot(root, "io.amiba.demo")

    const r = seedBundledExtensions(registryPath, [{ id: "io.amiba.demo", root: extRoot }])

    expect(r.seeded).toEqual(["io.amiba.demo"])
    expect(r.pruned).toEqual([])
    expect(findEntry(registryPath, "io.amiba.demo")?.source).toBe("bundled")
  })

  it("prunes bundled entries no longer in the shipped set", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "registry.json")

    // A bundled entry left over from a previous app version whose ext
    // was since promoted to a built-in page (dir may no longer exist).
    const stale: RegistryEntry = {
      id: "io.amiba.skills",
      source: "bundled",
      path: join(root, "gone"),
      version: "0.1.0",
    }
    addEntry(registryPath, stale)

    const r = seedBundledExtensions(registryPath, [])

    expect(r.pruned).toEqual(["io.amiba.skills"])
    expect(findEntry(registryPath, "io.amiba.skills")).toBeUndefined()
  })

  it("never prunes marketplace or local entries", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "registry.json")

    addEntry(registryPath, {
      id: "io.amiba.knowledge-base",
      source: "marketplace",
      path: join(root, "kb"),
    })
    addEntry(registryPath, {
      id: "io.amiba.dev-ext",
      source: "local",
      path: join(root, "dev"),
    })

    const r = seedBundledExtensions(registryPath, [])

    expect(r.pruned).toEqual([])
    expect(loadRegistry(registryPath).entries).toHaveLength(2)
  })

  it("preserves the disabled flag when re-seeding a moved/updated ext", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "registry.json")
    const extRoot = makeExtRoot(root, "io.amiba.demo", "0.2.0")

    addEntry(registryPath, {
      id: "io.amiba.demo",
      source: "bundled",
      path: join(root, "old-path"),
      version: "0.1.0",
      disabled: true,
    })

    const r = seedBundledExtensions(registryPath, [{ id: "io.amiba.demo", root: extRoot }])

    expect(r.updated).toEqual(["io.amiba.demo"])
    const entry = findEntry(registryPath, "io.amiba.demo")
    expect(entry?.version).toBe("0.2.0")
    expect(entry?.disabled).toBe(true)
  })
})
