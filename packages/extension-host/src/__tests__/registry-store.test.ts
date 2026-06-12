import { describe, expect, it, afterEach } from "vitest"
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  loadRegistry,
  saveRegistry,
  addEntry,
  removeEntry,
  findEntry,
  type RegistryEntry,
} from "../main/registry-store"

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "registry-store-test-"))
}

describe("registry-store", () => {
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

  it("1. save then load round-trips", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "extensions-registry.json")
    const entry: RegistryEntry = {
      id: "io.amiba.test",
      source: "local",
      path: "/some/path",
      addedAt: "2024-01-01T00:00:00.000Z",
    }
    saveRegistry(registryPath, { version: 1, entries: [entry] })
    const loaded = loadRegistry(registryPath)
    expect(loaded.version).toBe(1)
    expect(loaded.entries).toHaveLength(1)
    expect(loaded.entries[0]).toEqual(entry)
  })

  it("2. addEntry replaces an existing id (no duplicates)", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "extensions-registry.json")

    const entry1: RegistryEntry = { id: "io.amiba.test", source: "local", path: "/old/path" }
    addEntry(registryPath, entry1)
    const entry2: RegistryEntry = { id: "io.amiba.test", source: "local", path: "/new/path" }
    const reg = addEntry(registryPath, entry2)

    expect(reg.entries.filter((e) => e.id === "io.amiba.test")).toHaveLength(1)
    expect(reg.entries[0]!.path).toBe("/new/path")
  })

  it("3. removeEntry filters by id", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "extensions-registry.json")

    addEntry(registryPath, { id: "io.amiba.a", source: "local", path: "/a" })
    addEntry(registryPath, { id: "io.amiba.b", source: "local", path: "/b" })
    const reg = removeEntry(registryPath, "io.amiba.a")

    expect(reg.entries.find((e) => e.id === "io.amiba.a")).toBeUndefined()
    expect(reg.entries.find((e) => e.id === "io.amiba.b")).toBeDefined()
  })

  it("4. atomic write: no .tmp file left behind after success", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "extensions-registry.json")

    saveRegistry(registryPath, { version: 1, entries: [] })

    // After saveRegistry completes, the .tmp file should be gone.
    const tmpPath = `${registryPath}.${process.pid}.tmp`
    expect(existsSync(tmpPath)).toBe(false)
    // And the real file should exist.
    expect(existsSync(registryPath)).toBe(true)
  })

  it("5. malformed JSON returns empty registry without throwing", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "extensions-registry.json")

    writeFileSync(registryPath, "{ this is not json }", "utf8")

    const reg = loadRegistry(registryPath)
    expect(reg.version).toBe(1)
    expect(reg.entries).toHaveLength(0)
  })

  it("findEntry returns the correct entry", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "extensions-registry.json")

    addEntry(registryPath, { id: "io.amiba.a", source: "marketplace", path: "/a", version: "1.0.0" })
    addEntry(registryPath, { id: "io.amiba.b", source: "local", path: "/b" })

    const entry = findEntry(registryPath, "io.amiba.a")
    expect(entry).toBeDefined()
    expect(entry!.source).toBe("marketplace")
    expect(entry!.version).toBe("1.0.0")
    expect(findEntry(registryPath, "io.amiba.not-found")).toBeUndefined()
  })
})
