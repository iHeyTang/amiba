import { describe, expect, it, afterEach } from "vitest"
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { discoverFromUserData } from "../main/discover-fs"

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "discover-fs-test-"))
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

describe("discoverFromUserData", () => {
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

  it("returns empty when the directory does not exist", () => {
    const result = discoverFromUserData("/nonexistent/path/that/does/not/exist")
    expect(result.entries).toEqual([])
    expect(result.failed).toEqual([])
  })

  it("discovers a valid extension and returns a DiscoveredEntry", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "io.hermes.test")
    writeManifest(extDir, validManifest)

    const result = discoverFromUserData(root)
    expect(result.failed).toEqual([])
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.manifest.id).toBe("io.hermes.test")
    expect(result.entries[0]!.rootDir).toBe(extDir)
  })

  it("skips subdirectories that have no manifest.json", () => {
    const root = makeTmpDir()
    tmps.push(root)
    mkdirSync(join(root, "no-manifest"))

    const result = discoverFromUserData(root)
    expect(result.entries).toEqual([])
    expect(result.failed).toEqual([])
  })

  it("records invalid manifests in failed and skips them", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const extDir = join(root, "bad-ext")
    writeManifest(extDir, { id: "not-valid-id", name: "Bad", version: "0.1.0", entries: { renderer: "dist/renderer.js" } })

    const result = discoverFromUserData(root)
    expect(result.entries).toHaveLength(0)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.rootDir).toBe(extDir)
    expect(result.failed[0]!.error).toMatch(/id/)
  })

  it("records malformed JSON in failed and continues loading others", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const badDir = join(root, "bad-json")
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, "manifest.json"), "{ not valid json")

    const goodDir = join(root, "io.hermes.good")
    writeManifest(goodDir, { ...validManifest, id: "io.hermes.good" })

    const result = discoverFromUserData(root)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.manifest.id).toBe("io.hermes.good")
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.rootDir).toBe(badDir)
  })

  it("skips non-directory entries (files at the extensions root)", () => {
    const root = makeTmpDir()
    tmps.push(root)
    writeFileSync(join(root, "some-file.txt"), "hello")
    const extDir = join(root, "io.hermes.test")
    writeManifest(extDir, validManifest)

    const result = discoverFromUserData(root)
    expect(result.entries).toHaveLength(1)
    expect(result.failed).toHaveLength(0)
  })

  it("follows symlinks to extension directories", () => {
    const root = makeTmpDir()
    tmps.push(root)
    const realDir = makeTmpDir()
    tmps.push(realDir)
    writeManifest(realDir, validManifest)

    const linkPath = join(root, "io.hermes.test")
    symlinkSync(realDir, linkPath)

    const result = discoverFromUserData(root)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]!.manifest.id).toBe("io.hermes.test")
    // rootDir should be the symlink path, not the real path
    expect(result.entries[0]!.rootDir).toBe(linkPath)
  })
})
