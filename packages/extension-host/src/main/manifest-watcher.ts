// packages/extension-host/src/main/manifest-watcher.ts
import { watch as fsWatch } from "node:fs"
import { join } from "node:path"

export interface ManifestWatcher {
  stop(): void
  /** Re-arm watchers to match the current set of active extension ids. */
  setExtensionIds(ids: string[]): void
}

/**
 * Watch each known extension's manifest.json for mtime changes. On change,
 * call `onChange(extensionId)`. This is how the dev CLI signals "reload
 * me" — it touches the manifest after a rebuild.
 *
 * Uses node:fs.watch (not chokidar) to keep the host dependency-free.
 * Re-arms watchers when reload happens (the caller passes the updated id
 * list back via setExtensionIds).
 */
export function watchManifests(
  extensionsDir: string,
  initialIds: string[],
  onChange: (extensionId: string) => void,
): ManifestWatcher {
  const watchers = new Map<string, ReturnType<typeof fsWatch>>()

  const arm = (ids: string[]) => {
    // Remove watchers for extensions no longer present.
    for (const [id, w] of watchers) {
      if (!ids.includes(id)) {
        w.close()
        watchers.delete(id)
      }
    }
    // Add watchers for newly present extensions.
    for (const id of ids) {
      if (watchers.has(id)) continue
      try {
        const manifestPath = join(extensionsDir, id, "manifest.json")
        const w = fsWatch(manifestPath, () => onChange(id))
        watchers.set(id, w)
      } catch {
        // file may not exist yet — ignore, watcher can be re-armed later
      }
    }
  }

  arm(initialIds)

  return {
    setExtensionIds(ids: string[]) {
      arm(ids)
    },
    stop() {
      for (const w of watchers.values()) w.close()
      watchers.clear()
    },
  }
}
