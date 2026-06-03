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
  }
}
