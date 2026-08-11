// packages/extension-host/src/main/discover-registry.ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { validateManifest } from "./discover"
import {
  loadRegistry,
  type ExtensionSource,
  type RegistryEntry,
} from "./registry-store"
import type { ExtensionManifest } from "@amiba/extension-api"
import type {
  ExtensionRegistryItem,
  ExtensionRegistryStatus,
} from "../shared/registry"

export interface DiscoveredEntry {
  manifest: ExtensionManifest
  rootDir: string
  source: ExtensionSource
  registry: RegistryEntry
}

interface RuntimeRegistryEntry {
  id: string
  manifest: ExtensionManifest
  status: "loaded" | "failed" | "disabled" | "incompatible"
  error?: string
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
      if (!existsSync(r.path)) {
        failed.push({
          id: r.id,
          path: r.path,
          error: "extension directory missing",
        })
        continue
      }
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
      entries.push({
        manifest: v.manifest,
        rootDir: r.path,
        source: r.source,
        registry: r,
      })
    } catch (e) {
      failed.push({
        id: r.id,
        path: r.path,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return { entries, failed }
}

/**
 * Return every persisted registry row, enriched with its latest discovery and
 * runtime state. Unlike `discoverFromRegistry`, broken and disabled rows are
 * deliberately retained so the management UI can report and remove them.
 */
export function listRegistryInventory(
  registryPath: string,
  runtimeEntries: RuntimeRegistryEntry[],
): ExtensionRegistryItem[] {
  const persisted = loadRegistry(registryPath)
  const discovery = discoverFromRegistry(registryPath)
  const discoveredById = new Map(
    discovery.entries.map((entry) => [entry.registry.id, entry]),
  )
  const failedById = new Map(discovery.failed.map((entry) => [entry.id, entry]))
  const runtimeById = new Map(runtimeEntries.map((entry) => [entry.id, entry]))

  return persisted.entries.map((entry) => {
    const discovered = discoveredById.get(entry.id)
    const discoveryFailure = failedById.get(entry.id)
    const runtime = runtimeById.get(entry.id)

    let status: ExtensionRegistryStatus
    if (entry.disabled) {
      status = "disabled"
    } else if (discoveryFailure) {
      status = "failed"
    } else if (runtime) {
      status = runtime.status
    } else {
      status = "registered"
    }

    return {
      id: entry.id,
      source: entry.source,
      path: entry.path,
      version:
        entry.version ??
        discovered?.manifest.version ??
        runtime?.manifest.version,
      disabled: entry.disabled === true,
      status,
      error: discoveryFailure?.error ?? runtime?.error,
      manifest: discovered?.manifest ?? runtime?.manifest,
    }
  })
}
