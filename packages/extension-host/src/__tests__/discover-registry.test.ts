import { describe, expect, it, afterEach } from "vitest"
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { discoverFromRegistry } from "../main/discover-registry"
import { saveRegistry, type Registry } from "../main/registry-store"

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "discover-registry-test-"))
}

function writeManifest(dir: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest))
}

const validManifest = {
  id: "io.hermes.test",
  name: "Test",
  version: "0.1.0",
  entries: { renderer: "dist/renderer.js" },
}

describe("discoverFromRegistry", () => {
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

  it("1. empty registry → 0 entries", () => {
    const result = discoverFromRegistry("/nonexistent/path/extensions-registry.json")
    expect(result.entries).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it("2. valid local entry → 1 DiscoveredEntry with correct source", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.hermes.test")
    writeManifest(extDir, validManifest)

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [{ id: "io.hermes.test", source: "local", path: extDir, addedAt: "2024-01-01T00:00:00.000Z" }],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.failed).toHaveLength(0)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.manifest.id).toBe("io.hermes.test")
    expect(result.entries[0]!.rootDir).toBe(extDir)
    expect(result.entries[0]!.source).toBe("local")
    expect(result.entries[0]!.registry.addedAt).toBe("2024-01-01T00:00:00.000Z")
  })

  it("3. local entry whose path doesn't exist → in failed list, others still load", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const goodDir = join(root, "io.hermes.good")
    writeManifest(goodDir, { ...validManifest, id: "io.hermes.good" })

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [
        { id: "io.hermes.missing", source: "local", path: join(root, "does-not-exist") },
        { id: "io.hermes.good", source: "local", path: goodDir },
      ],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.manifest.id).toBe("io.hermes.good")
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.id).toBe("io.hermes.missing")
    expect(result.failed[0]!.error).toMatch(/manifest\.json missing/)
  })

  it("4. local entry whose manifest.id doesn't match registry id → in failed list", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.hermes.ext")
    // manifest has a different id than registry
    writeManifest(extDir, { ...validManifest, id: "io.hermes.different" })

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [{ id: "io.hermes.ext", source: "local", path: extDir }],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.entries).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.id).toBe("io.hermes.ext")
    expect(result.failed[0]!.error).toMatch(/does not match registry id/)
  })

  it("5. disabled entry → skipped (not in entries, not in failed)", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.hermes.test")
    writeManifest(extDir, validManifest)

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [{ id: "io.hermes.test", source: "local", path: extDir, disabled: true }],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.entries).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it("6. marketplace entry with version + sha256 → fields preserved on registry field", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.hermes.market")
    writeManifest(extDir, { ...validManifest, id: "io.hermes.market" })

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [
        {
          id: "io.hermes.market",
          source: "marketplace",
          path: extDir,
          version: "1.2.3",
          sha256: "abc123def456",
          installedAt: "2024-06-01T00:00:00.000Z",
        },
      ],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.source).toBe("marketplace")
    expect(result.entries[0]!.registry.version).toBe("1.2.3")
    expect(result.entries[0]!.registry.sha256).toBe("abc123def456")
    expect(result.entries[0]!.registry.installedAt).toBe("2024-06-01T00:00:00.000Z")
  })
})
