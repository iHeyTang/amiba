import { contextBridge, ipcRenderer } from "electron"

type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageChangeMap = Record<string, StorageChange>

// Mirrors @hermes-x/core protocol types — kept loose here so preload
// stays runtime-only without pulling the core package into the browser
// context's preload classpath.
type ChatClientMessage = unknown
type ChatEngineMessage = unknown

const api = {
  storage: {
    get: (keys?: string | string[]) => ipcRenderer.invoke("storage:get", keys),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("storage:set", patch),
    remove: (keys: string | string[]) => ipcRenderer.invoke("storage:remove", keys),
    onChanged: (cb: (changes: StorageChangeMap) => void) => {
      const handler = (_e: unknown, changes: StorageChangeMap) => cb(changes)
      ipcRenderer.on("storage:changed", handler)
      return () => ipcRenderer.off("storage:changed", handler)
    }
  },

  chat: {
    /** Send any ClientToEngineMessage to the main-process chat engine. */
    send: (msg: ChatClientMessage) => ipcRenderer.invoke("chat:client-to-engine", msg),
    /** Subscribe to engine → client frames (events + snapshots). */
    onMessage: (cb: (msg: ChatEngineMessage) => void) => {
      const handler = (_e: unknown, msg: ChatEngineMessage) => cb(msg)
      ipcRenderer.on("chat:engine-to-client", handler)
      return () => ipcRenderer.off("chat:engine-to-client", handler)
    }
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url)
  }
}

contextBridge.exposeInMainWorld("hermes", api)

export type HermesBridge = typeof api
