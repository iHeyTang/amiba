import { describe, expect, it, afterEach } from "vitest"
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  discoverFromRegistry,
  listRegistryInventory,
} from "../main/discover-registry"
import { saveRegistry, type Registry } from "../main/registry-store"

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "discover-registry-test-"))
}

function writeManifest(dir: string, manifest: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest))
}

const validManifest = {
  id: "io.amiba.test",
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
    const result = discoverFromRegistry(
      "/nonexistent/path/extensions-registry.json",
    )
    expect(result.entries).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it("2. valid local entry → 1 DiscoveredEntry with correct source", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.amiba.test")
    writeManifest(extDir, validManifest)

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [
        {
          id: "io.amiba.test",
          source: "local",
          path: extDir,
          addedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.failed).toHaveLength(0)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.manifest.id).toBe("io.amiba.test")
    expect(result.entries[0]!.rootDir).toBe(extDir)
    expect(result.entries[0]!.source).toBe("local")
    expect(result.entries[0]!.registry.addedAt).toBe("2024-01-01T00:00:00.000Z")
  })

  it("3. local entry whose path doesn't exist → in failed list, others still load", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const goodDir = join(root, "io.amiba.good")
    writeManifest(goodDir, { ...validManifest, id: "io.amiba.good" })

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [
        {
          id: "io.amiba.missing",
          source: "local",
          path: join(root, "does-not-exist"),
        },
        { id: "io.amiba.good", source: "local", path: goodDir },
      ],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.manifest.id).toBe("io.amiba.good")
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.id).toBe("io.amiba.missing")
    expect(result.failed[0]!.error).toMatch(/extension directory missing/)
  })

  it("4. local entry whose manifest.id doesn't match registry id → in failed list", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.amiba.ext")
    // manifest has a different id than registry
    writeManifest(extDir, { ...validManifest, id: "io.amiba.different" })

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [{ id: "io.amiba.ext", source: "local", path: extDir }],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.entries).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.id).toBe("io.amiba.ext")
    expect(result.failed[0]!.error).toMatch(/does not match registry id/)
  })

  it("5. disabled entry → skipped (not in entries, not in failed)", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.amiba.test")
    writeManifest(extDir, validManifest)

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [
        { id: "io.amiba.test", source: "local", path: extDir, disabled: true },
      ],
    }
    saveRegistry(registryPath, reg)

    const result = discoverFromRegistry(registryPath)
    expect(result.entries).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
  })

  it("6. marketplace entry with version + sha256 → fields preserved on registry field", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.amiba.market")
    writeManifest(extDir, { ...validManifest, id: "io.amiba.market" })

    const registryPath = join(root, "extensions-registry.json")
    const reg: Registry = {
      version: 1,
      entries: [
        {
          id: "io.amiba.market",
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
    expect(result.entries[0]!.registry.installedAt).toBe(
      "2024-06-01T00:00:00.000Z",
    )
  })

  it("7. inventory retains a broken registry row without a manifest", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const missingPath = join(root, "removed-extension")
    const registryPath = join(root, "extensions-registry.json")
    saveRegistry(registryPath, {
      version: 1,
      entries: [
        {
          id: "io.amiba.removed",
          source: "local",
          path: missingPath,
          addedAt: "2026-06-12T08:37:06.931Z",
        },
      ],
    })

    expect(listRegistryInventory(registryPath, [])).toEqual([
      {
        id: "io.amiba.removed",
        source: "local",
        path: missingPath,
        version: undefined,
        disabled: false,
        status: "failed",
        error: "extension directory missing",
        manifest: undefined,
      },
    ])
  })

  it("8. inventory merges valid manifests with runtime state", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.amiba.test")
    writeManifest(extDir, validManifest)
    const registryPath = join(root, "extensions-registry.json")
    saveRegistry(registryPath, {
      version: 1,
      entries: [{ id: "io.amiba.test", source: "marketplace", path: extDir }],
    })

    const manifest = discoverFromRegistry(registryPath).entries[0]!.manifest
    const inventory = listRegistryInventory(registryPath, [
      {
        id: "io.amiba.test",
        manifest,
        status: "loaded",
      },
    ])

    expect(inventory).toHaveLength(1)
    expect(inventory[0]).toMatchObject({
      id: "io.amiba.test",
      source: "marketplace",
      path: extDir,
      version: "0.1.0",
      status: "loaded",
      manifest: validManifest,
    })
  })

  it("9. inventory includes disabled rows", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const registryPath = join(root, "extensions-registry.json")
    saveRegistry(registryPath, {
      version: 1,
      entries: [
        {
          id: "io.amiba.disabled",
          source: "local",
          path: join(root, "disabled-extension"),
          disabled: true,
        },
      ],
    })

    expect(listRegistryInventory(registryPath, [])[0]).toMatchObject({
      id: "io.amiba.disabled",
      disabled: true,
      status: "disabled",
    })
  })
})
