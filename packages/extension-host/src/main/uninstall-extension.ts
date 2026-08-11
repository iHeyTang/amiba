import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

import type { ExtensionManifest } from "@amiba/extension-api"

import { findEntry, removeEntry } from "./registry-store"

export async function uninstallRegisteredExtension(opts: {
  registryPath: string
  extensionsRoot: string
  extensionId: string
  getManifests: () => ExtensionManifest[]
  unloadExtension: (id: string) => Promise<void>
}): Promise<{ ok: boolean; error?: string }> {
  const entry = findEntry(opts.registryPath, opts.extensionId)
  if (!entry) {
    return {
      ok: false,
      error: `extension ${opts.extensionId} is not registered`,
    }
  }

  // A broken registration has no in-memory manifest or runner. It still needs
  // to be removable from the persisted inventory.
  if (
    opts.getManifests().some((manifest) => manifest.id === opts.extensionId)
  ) {
    try {
      await opts.unloadExtension(opts.extensionId)
    } catch (error) {
      return {
        ok: false,
        error: `failed to unload: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  if (entry.source === "marketplace") {
    const extensionPath = join(opts.extensionsRoot, opts.extensionId)
    try {
      if (existsSync(extensionPath)) {
        rmSync(extensionPath, { recursive: true, force: true })
      }
    } catch (error) {
      return {
        ok: false,
        error: `unloaded but failed to remove directory: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  // Local source directories and bundled resources are never deleted here.
  removeEntry(opts.registryPath, opts.extensionId)
  return { ok: true }
}
