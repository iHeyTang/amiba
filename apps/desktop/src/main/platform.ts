import { shell } from "electron"
import type { PlatformAdapter, StorageChangeMap } from "@amiba/app-runtime/platform"

import { mainStore } from "./storage"
import { workspaceManager } from "./workspace"

/**
 * PlatformAdapter for the Electron main process.
 *
 * - **storage** is real (backed by `mainStore`, the same file the renderer
 *   sees through IPC), so shared main-process services read settings without
 *   round-tripping IPC back to themselves.
 * - **shell.openExternal** uses Electron's built-in shell module.
 * - Session-scoped workspace access is real and shared with IPC handlers.
 */
export function createMainPlatformAdapter(): PlatformAdapter {
  return {
    kind: "desktop",

    storage: {
      get: (keys) => mainStore.get(keys),
      set: (patch) => mainStore.set(patch),
      remove: (keys) => mainStore.remove(keys),
      watch: (keys, listener) => {
        const filter = keys === undefined ? null : Array.isArray(keys) ? keys : [keys]
        return mainStore.watch((changes: StorageChangeMap) => {
          if (filter === null) {
            listener(changes)
            return
          }
          const filtered: StorageChangeMap = {}
          for (const k of filter) {
            if (k in changes) filtered[k] = changes[k]
          }
          if (Object.keys(filtered).length > 0) listener(filtered)
        })
      }
    },

    shell: { openExternal: (url) => shell.openExternal(url) },

    workspaces: {
      getDefaultRoot: () => Promise.resolve(workspaceManager.getDefaultRoot()),
      bind: (sessionId, path) => workspaceManager.bind(sessionId, path),
      unbind: (sessionId) => workspaceManager.unbind(sessionId),
      getCurrent: (sessionId) =>
        Promise.resolve(workspaceManager.getForSession(sessionId)),
      listBindings: () => Promise.resolve(workspaceManager.listBindings()),
      onChange: (cb) => workspaceManager.onChange(cb)
    }
  }
}
