// packages/extension-host/src/main/manifest-watcher.ts
import { watch as fsWatch } from "node:fs"
import { join } from "node:path"

export interface ManifestWatcher {
  stop(): void
  /** Re-arm watchers to match the current set of active extension id→path entries. */
  setExtensionPaths(paths: Map<string, string>): void
}

/**
 * Watch each known extension's manifest.json for mtime changes. On change,
 * call `onChange(extensionId)`. This is how the dev CLI signals "reload
 * me" — it touches the manifest after a rebuild.
 *
 * Uses node:fs.watch (not chokidar) to keep the host dependency-free.
 * Re-arms watchers when reload happens (the caller passes the updated
 * id→path map back via setExtensionPaths).
 */
export function watchManifests(
  initialPaths: Map<string, string>,
  onChange: (extensionId: string) => void,
): ManifestWatcher {
  const watchers = new Map<string, ReturnType<typeof fsWatch>>()

  const arm = (paths: Map<string, string>) => {
    // Remove watchers for extensions no longer present.
    for (const [id, w] of watchers) {
      if (!paths.has(id)) {
        w.close()
        watchers.delete(id)
      }
    }
    // Add watchers for newly present extensions.
    for (const [id, rootDir] of paths) {
      if (watchers.has(id)) continue
      try {
        const manifestPath = join(rootDir, "manifest.json")
        const w = fsWatch(manifestPath, () => onChange(id))
        watchers.set(id, w)
      } catch {
        // file may not exist yet — ignore, watcher can be re-armed later
      }
    }
  }

  arm(initialPaths)

  return {
    setExtensionPaths(paths: Map<string, string>) {
      arm(paths)
    },
    stop() {
      for (const w of watchers.values()) w.close()
      watchers.clear()
    },
  }
}
