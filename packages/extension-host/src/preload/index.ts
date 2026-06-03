// packages/extension-host/src/preload/index.ts
import { ipcRenderer } from "electron"
import type { ExtensionManifest } from "@hermes-x/extension-api"

export interface ExtensionsBridge {
  listManifests(): Promise<ExtensionManifest[]>
  invoke(extensionId: string, channel: string, args: unknown): Promise<unknown>
  rendererBundleUrl(extensionId: string): Promise<string | null>
  i18nResources(
    extensionId: string,
    locale: "en" | "zh-CN",
  ): Promise<Record<string, string>>
  status(): Promise<Array<{ id: string; status: string; error?: string }>>
  /** Open a native folder-picker dialog and return the chosen path or null. */
  pickFolder(): Promise<string | null>
  /** Symlink a local folder into the extensions dir and activate it. */
  sideload(path: string): Promise<{ ok: boolean; id?: string; error?: string }>
  /** Reload an already-loaded extension by id. */
  reload(id: string): Promise<{ ok: boolean; error?: string }>
  /** Unload and delete (or unlink) an extension by id. */
  uninstall(id: string): Promise<{ ok: boolean; error?: string }>
}

export function createExtensionsBridge(): ExtensionsBridge {
  return {
    listManifests: () => ipcRenderer.invoke("extensions:list"),
    invoke: (extensionId, channel, args) =>
      ipcRenderer.invoke("ext-invoke", { extensionId, channel, args }),
    rendererBundleUrl: (extensionId) =>
      ipcRenderer.invoke("extensions:renderer-bundle-url", extensionId),
    i18nResources: (extensionId, locale) =>
      ipcRenderer.invoke("extensions:i18n", { extensionId, locale }),
    status: () => ipcRenderer.invoke("extensions:status"),
    pickFolder: () => ipcRenderer.invoke("extensions:show-picker"),
    sideload: (path) => ipcRenderer.invoke("extensions:sideload", path),
    reload: (id) => ipcRenderer.invoke("extensions:reload", id),
    uninstall: (id) => ipcRenderer.invoke("extensions:uninstall", id),
  }
}
