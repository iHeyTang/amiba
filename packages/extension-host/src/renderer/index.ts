// packages/extension-host/src/renderer/index.ts
export { createSlotRegistry, type SlotRegistry } from "./slot-registry"
export { SlotOutlet, SingleSlotOutlet, SlotRegistryProvider, useSlotRegistry } from "./slot-outlet"
export { makeRendererHost } from "./make-renderer-host"
export { discoverRendererExtensions } from "./discover"
export { useI18n, type Catalog, type CatalogMap, type Translator } from "./use-i18n"

import { useEffect, useState } from "react"
import type { Disposable } from "@hermes-x/extension-api"
import type { ExtensionsBridge } from "../preload/index"

type HermesWindowShape = { extensions: ExtensionsBridge }
import { useSlotRegistry } from "./slot-outlet"
import type { DiscoveredExtension } from "./discover"
import { getCurrentLanguage, subscribeLanguage } from "@hermes-x/i18n"

/**
 * Host-side language subscription for SlotOutlet consumers that render
 * extension-provided labels (ActivityBar, Settings tabs). The extension
 * registers slot props of the form `{ labels: { en: "...", "zh-CN": "..." } }`
 * and the host hook below picks the entry matching the current locale.
 */
function useCurrentLanguage(): string {
  const [lang, setLang] = useState<string>(() => getCurrentLanguage())
  useEffect(() => {
    setLang(getCurrentLanguage())
    return subscribeLanguage((next) => setLang(next))
  }, [])
  return lang
}

function pickLabel(
  labels: Record<string, string> | undefined,
  language: string,
  fallback: string,
): string {
  if (!labels) return fallback
  return labels[language] ?? labels.en ?? fallback
}

export interface RendererBootResult {
  activated: string[]
  failed: Array<{ id: string; error: string }>
  /** Unload a single extension by id (disposes all its slot registrations). */
  unloadExtension: (id: string) => Promise<void>
  /**
   * Unload then re-activate a single extension. The caller must supply an
   * updated `DiscoveredExtension` for the new version (already re-imported).
   */
  reloadExtension: (
    id: string,
    newExt: DiscoveredExtension,
  ) => Promise<void>
}

/**
 * Boot the renderer side of the extension host: load each renderer bundle
 * (if any) and call its `activate(host)`. i18n is intentionally NOT loaded
 * by the host — each extension bundles its own catalogs and resolves keys
 * via the `useI18n(host, catalogs)` helper.
 *
 * `makeHostFor` receives both the extension id and a fresh `Disposable[]`
 * array — it must pass that array as `deps.disposables` to `makeRendererHost`
 * so the host can track registrations for clean unload.
 *
 * @returns list of activated extensions + failures + unload/reload helpers.
 */
export async function bootRendererExtensions(opts: {
  extensions: DiscoveredExtension[]
  makeHostFor: (id: string, disposables: Disposable[]) => import("@hermes-x/extension-api").RendererHost
}): Promise<RendererBootResult> {
  const activated: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  // Per-extension disposable tracking.
  const extDisposables = new Map<string, Disposable[]>()

  const activateExt = async (ext: DiscoveredExtension) => {
    const { manifest } = ext
    const disposables: Disposable[] = []
    extDisposables.set(manifest.id, disposables)
    try {
      if (ext.loadRenderer) {
        const mod = await ext.loadRenderer()
        await Promise.resolve(mod.activate(opts.makeHostFor(manifest.id, disposables)))
      }
      activated.push(manifest.id)
    } catch (e) {
      failed.push({ id: manifest.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  for (const ext of opts.extensions) {
    await activateExt(ext)
  }

  const unloadExtension = async (id: string): Promise<void> => {
    const disposables = extDisposables.get(id)
    if (disposables) {
      for (const d of disposables) {
        try { d.dispose() } catch { /* ignore */ }
      }
      extDisposables.delete(id)
    }
  }

  const reloadExtension = async (
    id: string,
    newExt: DiscoveredExtension,
  ): Promise<void> => {
    await unloadExtension(id)
    await activateExt(newExt)
  }

  return { activated, failed, unloadExtension, reloadExtension }
}

export function useExtensionSettingsTabs(): Array<{
  id: string
  label: string
  icon: string
  order?: number
}> {
  const reg = useSlotRegistry()
  const language = useCurrentLanguage()
  const [snapshot, setSnapshot] = useState(() => reg.get("settings.tab"))
  useEffect(() => {
    const sub = reg.subscribe(() => setSnapshot(reg.get("settings.tab")))
    return () => sub.dispose()
  }, [reg])
  return snapshot.map((e) => {
    const p = (e.props ?? {}) as {
      labels?: Record<string, string>
      icon?: string
      order?: number
    }
    return {
      id: e.entryId,
      label: pickLabel(p.labels, language, e.entryId),
      icon: p.icon ?? "",
      order: p.order ?? e.order,
    }
  })
}

export function useActivityBarItems(): Array<{
  id: string
  icon: string
  label: string
  order?: number
}> {
  const reg = useSlotRegistry()
  const language = useCurrentLanguage()
  const [snapshot, setSnapshot] = useState(() => reg.get("activityBar.item"))
  useEffect(() => {
    const sub = reg.subscribe(() => setSnapshot(reg.get("activityBar.item")))
    return () => sub.dispose()
  }, [reg])
  return snapshot.map((e) => {
    const props = (e.props ?? {}) as {
      icon?: string
      labels?: Record<string, string>
      order?: number
    }
    return {
      id: e.entryId,
      icon: props.icon ?? "",
      label: pickLabel(props.labels, language, e.entryId),
      order: props.order ?? e.order,
    }
  })
}

export function useExtensionRegistry(refreshKey: number = 0) {
  const [items, setItems] = useState<
    Array<{
      id: string
      status: string
      error?: string
      source?: string
      manifest: import("@hermes-x/extension-api").ExtensionManifest
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
