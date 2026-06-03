// packages/extension-host/src/renderer/index.ts
export { createSlotRegistry, type SlotRegistry } from "./slot-registry"
export { SlotOutlet, SingleSlotOutlet, SlotRegistryProvider, useSlotRegistry } from "./slot-outlet"
export { makeRendererHost } from "./make-renderer-host"
export { discoverRendererExtensions } from "./discover"
export { useI18n, type Catalog, type CatalogMap, type Translator } from "./use-i18n"

import { useEffect, useState } from "react"
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

/**
 * Boot the renderer side of the extension host: load each renderer bundle
 * (if any) and call its `activate(host)`. i18n is intentionally NOT loaded
 * by the host — each extension bundles its own catalogs and resolves keys
 * via the `useI18n(host, catalogs)` helper.
 *
 * @returns list of activated extensions + failures.
 */
export async function bootRendererExtensions(opts: {
  extensions: DiscoveredExtension[]
  makeHostFor: (id: string) => import("@hermes-x/extension-api").RendererHost
}): Promise<{
  activated: string[]
  failed: Array<{ id: string; error: string }>
}> {
  const activated: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const ext of opts.extensions) {
    const { manifest } = ext
    try {
      if (ext.loadRenderer) {
        const mod = await ext.loadRenderer()
        await Promise.resolve(mod.activate(opts.makeHostFor(manifest.id)))
      }
      activated.push(manifest.id)
    } catch (e) {
      failed.push({ id: manifest.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { activated, failed }
}

export function useExtensionSettingsTabs(): Array<{
  id: string
  label: string
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
    const p = (e.props ?? {}) as { labels?: Record<string, string>; order?: number }
    return {
      id: e.entryId,
      label: pickLabel(p.labels, language, e.entryId),
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

export function useExtensionRegistry() {
  const [items, setItems] = useState<
    Array<{
      id: string
      status: string
      error?: string
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
        })),
      )
    })
  }, [])
  return items
}
