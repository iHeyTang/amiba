import { shell } from "electron"
import type { PlatformAdapter, StorageChangeMap } from "@amiba/platform"

import { mainStore } from "./storage"
import { workspaceManager } from "./workspace"

const notImpl = (name: string) => () =>
  Promise.reject(new Error(`[MainPlatformAdapter] ${name} not implemented (main process)`))

/**
 * PlatformAdapter for the Electron main process.
 *
 * - **storage** is real (backed by `mainStore`, the same file the renderer
 *   sees through IPC). Lets shared code in @amiba/core (`backplaneFetch`,
 *   `HermesClient`) read settings.* keys from main without round-tripping
 *   IPC back to itself.
 * - **shell.openExternal** uses Electron's built-in shell module.
 * - Every other sub-API is `notImpl` — those are browser-extension concepts
 *   (chrome.tabs, chrome.bookmarks, …) with no desktop counterpart.
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

    runtime: {
      sendMessage: notImpl("runtime.sendMessage") as never,
      onMessage: () => () => {},
      getInstallId: notImpl("runtime.getInstallId") as never
    },

    tabs: {
      query: notImpl("tabs.query") as never,
      create: notImpl("tabs.create") as never,
      update: notImpl("tabs.update") as never,
      remove: notImpl("tabs.remove") as never
    },

    scripting: { executeScript: notImpl("scripting.executeScript") as never },
    bookmarks: { search: notImpl("bookmarks.search") as never },
    history: { search: notImpl("history.search") as never },
    windows: {
      getCurrent: notImpl("windows.getCurrent") as never,
      create: notImpl("windows.create") as never
    },
    notifications: { notify: notImpl("notifications.notify") as never },

    shell: { openExternal: (url) => shell.openExternal(url) },

    workspaces: {
      bind: (sessionId, path) => workspaceManager.bind(sessionId, path),
      unbind: (sessionId) => workspaceManager.unbind(sessionId),
      getCurrent: (sessionId) =>
        Promise.resolve(workspaceManager.getForSession(sessionId)),
      onChange: (cb) => workspaceManager.onChange(cb)
    }
  }
}
