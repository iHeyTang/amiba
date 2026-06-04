// packages/extension-host/src/renderer/index.ts
//
// Public API for the renderer side of the extension host.
// Slot-based machinery (slot-registry, slot-outlet, make-renderer-host,
// discover, use-i18n) has been removed — extensions now contribute via
// manifest declarations and render into isolated WebViews.

export { ExtensionWebView } from "./extension-webview"
export {
  useActivityBarItems,
  useSidebarViews,
  useExtensionSettingsTabs,
  useComposerHints,
  type ActivityBarItem,
  type SidebarViewContribution,
  type SettingsTabContribution,
  type ComposerHintContribution,
} from "./use-contributes"

// useExtensionRegistry is used by the SettingsExtensions tab to list installed
// extensions and their status.
import { useEffect, useState } from "react"
import type { ExtensionManifest } from "@hermes-x/extension-api"

type HermesWindowShape = {
  extensions: {
    listManifests(): Promise<ExtensionManifest[]>
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
    const { extensions } = (window as unknown as { hermes: HermesWindowShape }).hermes
    void Promise.all([
      extensions.listManifests(),
      extensions.status(),
    ]).then(([manifests, statuses]) => {
      const byId = new Map(statuses.map((s) => [s.id, s]))
      setItems(
        manifests.map((m) => ({
          id: m.id,
          manifest: m,
          status: byId.get(m.id)?.status ?? "loaded",
          error: byId.get(m.id)?.error,
          source: byId.get(m.id)?.source,
        })),
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  return items
}
