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
  i18nResources(
    extensionId: string,
    locale: "en" | "zh-CN",
  ): Promise<Record<string, string>>
  status(): Promise<Array<{ id: string; status: string; error?: string; source?: string }>>
  /** Open a native folder-picker dialog and return the chosen path or null. */
  pickFolder(): Promise<string | null>
  /** Register a local folder in the registry and activate it. No file copying. */
  addLocal(path: string): Promise<{ ok: boolean; id?: string; error?: string }>
  /** Reload an already-loaded extension by id. */
  reload(id: string): Promise<{ ok: boolean; error?: string }>
  /** Unload and delete (or unlink) an extension by id. */
  uninstall(id: string): Promise<{ ok: boolean; error?: string }>
  /** Marketplace install flow. */
  marketplace: MarketplaceBridge
  /**
   * Subscribe to `extensions:changed` pushed from main. The optional
   * `extensionId` payload identifies the affected extension when known
   * (sideload, uninstall, reload, manifest hot-reload, marketplace install);
   * `null` means "we don't know which one — do a full sync."
   * Returns an unsubscribe fn.
   */
  onExtensionsChanged(cb: (extensionId: string | null) => void): () => void
}

export function createExtensionsBridge(): ExtensionsBridge {
  return {
    listManifests: () => ipcRenderer.invoke("extensions:list"),
    invoke: (extensionId, channel, args) =>
      ipcRenderer.invoke("ext-invoke", { extensionId, channel, args }),
    i18nResources: (extensionId, locale) =>
      ipcRenderer.invoke("extensions:i18n", { extensionId, locale }),
    status: () => ipcRenderer.invoke("extensions:status"),
    pickFolder: () => ipcRenderer.invoke("extensions:show-picker"),
    addLocal: (path) => ipcRenderer.invoke("extensions:add-local", path),
    reload: (id) => ipcRenderer.invoke("extensions:reload", id),
    uninstall: (id) => ipcRenderer.invoke("extensions:uninstall", id),
    marketplace: {
      getIndexUrl: () => ipcRenderer.invoke("marketplace:index-url"),
      list: () => ipcRenderer.invoke("marketplace:list"),
      install: (entry: MarketplaceEntry) =>
        ipcRenderer.invoke("marketplace:install", entry),
    },
    onExtensionsChanged: (cb: (extensionId: string | null) => void) => {
      const handler = (_e: unknown, extensionId: string | null) => cb(extensionId)
      ipcRenderer.on("extensions:changed", handler)
      return () => ipcRenderer.off("extensions:changed", handler)
    },
  }
}

/**
 * Returns the absolute file:// path of the compiled webview bridge preload
 * bundle. The desktop renderer passes this to `<webview preload="...">` so
 * extension pages get `window.hermes` injected.
 */
export function createWebviewPreloadBridge() {
  return {
    getWebviewPreloadPath: (): Promise<string> =>
      ipcRenderer.invoke("webview:preload-path"),
    getWebviewInitState: (): Promise<{ language: string; theme: string }> =>
      ipcRenderer.invoke("webview:get-state-async", ""),
  }
}
