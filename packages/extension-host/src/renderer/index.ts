// packages/extension-host/src/renderer/index.ts
//
// Public API for the renderer side of the extension host.
// Slot-based machinery (slot-registry, slot-outlet, make-renderer-host,
// discover, use-i18n) has been removed — extensions now contribute via
// manifest declarations and render into isolated WebViews.

export { ExtensionWebView } from "./extension-webview"
export {
  desktopBridge,
  maybeDesktopBridge,
  type AmibaRendererBridge,
} from "./bridge"
export {
  useExtensionMains,
  useExtensionSettings,
  type MainContribution,
  type SettingsContribution,
} from "./use-contributes"

// useExtensionRegistry is used by the SettingsExtensions tab to list installed
// extensions and their status.
import { useEffect, useState } from "react"
import type { ExtensionRegistryItem } from "../preload"
import { desktopBridge } from "./bridge"

export function useExtensionRegistry(refreshKey: number = 0) {
  const [items, setItems] = useState<ExtensionRegistryItem[]>([])
  useEffect(() => {
    const { extensions } = desktopBridge()
    void extensions.listRegistry().then(setItems)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  return items
}
