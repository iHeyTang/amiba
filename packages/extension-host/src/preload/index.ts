// packages/extension-host/src/preload/index.ts
import { ipcRenderer } from "electron"
import type { ExtensionManifest } from "@hermes-x/extension-api"

export interface MarketplaceEntry {
  id: string
  name: string
  description?: string
  author?: string
  /** "owner/repo" — the plugin's own GitHub repository */
  repo: string
  /** Optional override: pin to a specific tag. Default = latest release. */
  version?: string
}

export interface MarketplaceBridge {
  /** Returns the current marketplace index URL (respects HERMES_X_MARKETPLACE_INDEX_URL). */
  getIndexUrl(): Promise<string>
  list(): Promise<
    | { ok: true; entries: MarketplaceEntry[] }
    | { ok: false; error: string }
  >
  install(entry: MarketplaceEntry): Promise<
    | { ok: true; id: string; version: string }
    | { ok: false; error: string }
  >
}

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
  /** Marketplace install flow. */
  marketplace: MarketplaceBridge
  /** Subscribe to `extensions:changed` pushed from main after installs. Returns unsubscribe fn. */
  onExtensionsChanged(cb: () => void): () => void
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
    marketplace: {
      getIndexUrl: () => ipcRenderer.invoke("marketplace:index-url"),
      list: () => ipcRenderer.invoke("marketplace:list"),
      install: (entry: MarketplaceEntry) =>
        ipcRenderer.invoke("marketplace:install", entry),
    },
    onExtensionsChanged: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on("extensions:changed", handler)
      return () => ipcRenderer.off("extensions:changed", handler)
    },
  }
}
