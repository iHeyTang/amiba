// packages/extension-host/src/main/discover-fs.ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionManifest } from "@hermes-x/extension-api"
import { validateManifest } from "./discover"

export interface DiscoveredEntry {
  manifest: ExtensionManifest
  rootDir: string // absolute path to the extension dir
}

/**
 * Scan `extensionsDir` (typically `<userData>/extensions/`) for installed
 * extensions. Each subdirectory containing a valid `manifest.json` becomes
 * a `DiscoveredEntry`. Invalid manifests are logged and skipped — the rest
 * still load.
 *
 * Symlinks are followed (sideloaded dev directories are typically symlinks
 * pointing back into a source tree).
 */
export function discoverFromUserData(extensionsDir: string): {
  entries: DiscoveredEntry[]
  failed: Array<{ rootDir: string; error: string }>
} {
  const entries: DiscoveredEntry[] = []
  const failed: Array<{ rootDir: string; error: string }> = []
  if (!existsSync(extensionsDir)) return { entries, failed }

  for (const name of readdirSync(extensionsDir)) {
    const rootDir = join(extensionsDir, name)
    try {
      const st = statSync(rootDir) // follows symlinks
      if (!st.isDirectory()) continue
      const manifestPath = join(rootDir, "manifest.json")
      if (!existsSync(manifestPath)) continue
      const raw = JSON.parse(readFileSync(manifestPath, "utf8"))
      const v = validateManifest(raw)
      if (!v.ok) {
        failed.push({ rootDir, error: v.error })
        continue
      }
      entries.push({ manifest: v.manifest, rootDir })
    } catch (e) {
      failed.push({ rootDir, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { entries, failed }
}
