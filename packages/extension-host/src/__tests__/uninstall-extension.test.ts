import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { loadRegistry, saveRegistry } from "../main/registry-store"
import { uninstallRegisteredExtension } from "../main/uninstall-extension"

describe("uninstallRegisteredExtension", () => {
  const temporaryRoots: string[] = []

  afterEach(() => {
    for (const root of temporaryRoots) {
      rmSync(root, { recursive: true, force: true })
    }
    temporaryRoots.length = 0
  })

  it("unlinks a broken local row without deleting its source directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "uninstall-extension-test-"))
    temporaryRoots.push(root)
    const sourcePath = join(root, "broken-local-extension")
    mkdirSync(sourcePath)
    const registryPath = join(root, "extensions-registry.json")
    saveRegistry(registryPath, {
      version: 1,
      entries: [
        {
          id: "io.amiba.broken",
          source: "local",
          path: sourcePath,
        },
      ],
    })
    const unloadExtension = vi.fn()

    const result = await uninstallRegisteredExtension({
      registryPath,
      extensionsRoot: join(root, "marketplace"),
      extensionId: "io.amiba.broken",
      getManifests: () => [],
      unloadExtension,
    })

    expect(result).toEqual({ ok: true })
    expect(unloadExtension).not.toHaveBeenCalled()
    expect(loadRegistry(registryPath).entries).toEqual([])
    expect(existsSync(sourcePath)).toBe(true)
  })
})
