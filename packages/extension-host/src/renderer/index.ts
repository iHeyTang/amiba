// packages/extension-host/src/renderer/index.ts
//
// Public API for the renderer side of the extension host.
// Slot-based machinery (slot-registry, slot-outlet, make-renderer-host,
// discover, use-i18n) has been removed — extensions now contribute via
// manifest declarations and render into isolated WebViews.

export { ExtensionWebView } from "./extension-webview"
export {
  useExtensionMains,
  useExtensionSettings,
  type MainContribution,
  type SettingsContribution,
} from "./use-contributes"

// useExtensionRegistry is used by the SettingsExtensions tab to list installed
// extensions and their status.
import { useEffect, useState } from "react"
import type { ExtensionManifest } from "@amiba/extension-api"

type AmibaWindowShape = {
  extensions: {
    // The actual IPC payload is { manifest, path } per row — the preload
    // signature lines up with `getManifestEntries()` on the main side.
    // The renderer type used to mis-declare this as ExtensionManifest[]
    // which made every consumer reach into undefined for name/id/version
    // and render blank chrome.
    listManifests(): Promise<Array<{ manifest: ExtensionManifest; path: string }>>
    status(): Promise<Array<{ id: string; status: string; error?: string; source?: string }>>
  }
}

export function useExtensionRegistry(refreshKey: number = 0) {
  const [items, setItems] = useState<
    Array<{
      id: string
      status: string
      error?: string
      source?: string
      manifest: ExtensionManifest
    }>
  >([])
  useEffect(() => {
    const { extensions } = (window as unknown as { amiba: AmibaWindowShape }).amiba
    void Promise.all([
      extensions.listManifests(),
      extensions.status(),
    ]).then(([entries, statuses]) => {
      const byId = new Map(statuses.map((s) => [s.id, s]))
      setItems(
        entries.map(({ manifest }) => ({
          id: manifest.id,
          manifest,
          status: byId.get(manifest.id)?.status ?? "loaded",
          error: byId.get(manifest.id)?.error,
          source: byId.get(manifest.id)?.source,
        })),
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  return items
}
