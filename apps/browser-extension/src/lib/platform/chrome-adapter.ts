import type { PlatformAdapter, StorageChangeMap } from "@hermes-x/platform"

/**
 * Maps the runtime-agnostic PlatformAdapter to MV3 chrome.* APIs.
 *
 * Call `setPlatform(createChromeAdapter())` at the very top of every entry
 * point that mounts React (sidepanel, options, newtab, tabs/chat) — must run
 * before any component that uses i18n/theme hooks renders.
 */

export function createChromeAdapter(): PlatformAdapter {
  return {
    kind: "extension",

    storage: {
      get: (keys) => chrome.storage.local.get(keys ?? null),
      set: (patch) => chrome.storage.local.set(patch),
      remove: (keys) => chrome.storage.local.remove(keys),
      watch: (keys, listener) => {
        const filter = keys === undefined ? null : Array.isArray(keys) ? keys : [keys]
        const onChanged = (
          changes: { [k: string]: chrome.storage.StorageChange },
          area: chrome.storage.AreaName
        ) => {
          if (area !== "local") return
          if (filter === null) {
            listener(changes as StorageChangeMap)
            return
          }
          const filtered: StorageChangeMap = {}
          for (const k of filter) {
            if (k in changes) filtered[k] = changes[k]
          }
          if (Object.keys(filtered).length > 0) listener(filtered)
        }
        chrome.storage.onChanged.addListener(onChanged)
        return () => chrome.storage.onChanged.removeListener(onChanged)
      }
    },

    runtime: {
      sendMessage: (msg) => chrome.runtime.sendMessage(msg),
      onMessage: (listener) => {
        const handler = (
          msg: unknown,
          _sender: chrome.runtime.MessageSender,
          sendResponse: (response?: unknown) => void
        ) => {
          listener(msg)
          // Don't keep the message channel open — fire-and-forget.
          sendResponse(undefined)
          return false
        }
        chrome.runtime.onMessage.addListener(handler)
        return () => chrome.runtime.onMessage.removeListener(handler)
      },
      getInstallId: async () => {
        const id = chrome.runtime.id
        if (id) return id
        // Fallback for unusual contexts where chrome.runtime.id is unset.
        const r = await chrome.storage.local.get(["__install_id"])
        if (typeof r.__install_id === "string") return r.__install_id
        const fresh =
          (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
          Math.random().toString(36).slice(2)
        await chrome.storage.local.set({ __install_id: fresh })
        return fresh
      }
    },

    tabs: {
      query: (filter) =>
        chrome.tabs.query(filter as chrome.tabs.QueryInfo).then((ts) =>
          ts.map((t) => ({
            id: t.id ?? -1,
            url: t.url,
            title: t.title,
            active: t.active,
            windowId: t.windowId
          }))
        ),
      create: (opts) =>
        chrome.tabs.create(opts).then((t) => ({
          id: t.id ?? -1,
          url: t.url,
          title: t.title,
          active: t.active,
          windowId: t.windowId
        })),
      update: (tabId, opts) =>
        chrome.tabs.update(tabId, opts).then((t) => ({
          id: t?.id ?? tabId,
          url: t?.url,
          title: t?.title,
          active: t?.active,
          windowId: t?.windowId
        })),
      remove: (tabId) =>
        Array.isArray(tabId) ? chrome.tabs.remove(tabId) : chrome.tabs.remove(tabId)
    },

    scripting: {
      executeScript: <R,>({ tabId, func }: { tabId: number; func: () => R }) =>
        chrome.scripting
          .executeScript({ target: { tabId }, func })
          .then((results) => results.map((r) => r.result as R))
    },

    bookmarks: {
      search: (query) =>
        chrome.bookmarks.search(query).then((bs) =>
          bs.map((b) => ({ id: b.id, title: b.title, url: b.url }))
        )
    },

    history: {
      search: (opts) =>
        chrome.history.search(opts).then((hs) =>
          hs.map((h) => ({
            id: h.id ?? "",
            url: h.url,
            title: h.title,
            lastVisitTime: h.lastVisitTime
          }))
        )
    },

    windows: {
      getCurrent: () =>
        chrome.windows.getCurrent().then((w) => ({
          id: w.id ?? -1,
          focused: !!w.focused
        })),
      create: (opts) => chrome.windows.create(opts).then((w) => ({ id: w?.id ?? -1 }))
    },

    notifications: {
      notify: ({ title, body, iconUrl }) =>
        new Promise<void>((resolve) => {
          chrome.notifications.create(
            {
              type: "basic",
              title,
              message: body,
              iconUrl: iconUrl ?? chrome.runtime.getURL("assets/icon128.png")
            },
            () => resolve()
          )
        })
    },

    shell: {
      openExternal: async (url) => {
        await chrome.tabs.create({ url })
      }
    }
  }
}
