// packages/extension-host/src/main/discover-registry.ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { validateManifest } from "./discover"
import { loadRegistry, type ExtensionSource, type RegistryEntry } from "./registry-store"
import type { ExtensionManifest } from "@amiba/extension-api"

export interface DiscoveredEntry {
  manifest: ExtensionManifest
  rootDir: string
  source: ExtensionSource
  registry: RegistryEntry
}

/**
 * Read the registry, validate the manifest at each entry's path. Entries
 * with missing dirs or invalid manifests are reported as failed but the
 * rest still load — this lets a single broken local entry not block the
 * whole launch.
 */
export function discoverFromRegistry(registryPath: string): {
  entries: DiscoveredEntry[]
  failed: Array<{ id: string; path: string; error: string }>
} {
  const reg = loadRegistry(registryPath)
  const entries: DiscoveredEntry[] = []
  const failed: Array<{ id: string; path: string; error: string }> = []
  for (const r of reg.entries) {
    if (r.disabled) continue
    try {
      const manifestPath = join(r.path, "manifest.json")
      if (!existsSync(manifestPath)) {
        failed.push({ id: r.id, path: r.path, error: "manifest.json missing" })
        continue
      }
      const raw = JSON.parse(readFileSync(manifestPath, "utf8"))
      const v = validateManifest(raw)
      if (!v.ok) {
        failed.push({ id: r.id, path: r.path, error: v.error })
        continue
      }
      if (v.manifest.id !== r.id) {
        failed.push({
          id: r.id,
          path: r.path,
          error: `manifest id "${v.manifest.id}" does not match registry id "${r.id}"`,
        })
        continue
      }
      entries.push({ manifest: v.manifest, rootDir: r.path, source: r.source, registry: r })
    } catch (e) {
      failed.push({ id: r.id, path: r.path, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { entries, failed }
}
