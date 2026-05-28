import type { PlatformAdapter, StorageChangeMap } from "@hermes-x/platform"

const notImpl = (name: string) => () =>
  Promise.reject(new Error(`[ElectronAdapter] ${name} not implemented yet`))

export function createElectronAdapter(): PlatformAdapter {
  const bridge = window.hermes

  return {
    kind: "desktop",

    storage: {
      get: (keys) => bridge.storage.get(keys),
      set: (patch) => bridge.storage.set(patch),
      remove: (keys) => bridge.storage.remove(keys),
      watch: (keys, listener) => {
        const filter = keys === undefined ? null : Array.isArray(keys) ? keys : [keys]
        return bridge.storage.onChanged((changes: StorageChangeMap) => {
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

    scripting: {
      executeScript: notImpl("scripting.executeScript") as never
    },

    bookmarks: { search: notImpl("bookmarks.search") as never },
    history: { search: notImpl("history.search") as never },

    windows: {
      getCurrent: notImpl("windows.getCurrent") as never,
      create: notImpl("windows.create") as never
    },

    notifications: { notify: notImpl("notifications.notify") as never },

    shell: { openExternal: (url) => bridge.shell.openExternal(url) }
  }
}
