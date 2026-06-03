// packages/extension-host/src/renderer/index.ts
export { createSlotRegistry, type SlotRegistry } from "./slot-registry"
export { SlotOutlet, SingleSlotOutlet, SlotRegistryProvider, useSlotRegistry } from "./slot-outlet"
export { makeRendererHost } from "./make-renderer-host"
export { discoverRendererExtensions } from "./discover"
export { mergeExtensionTables, prefixTable } from "./i18n-merge"

import { useEffect, useState } from "react"
import { useSlotRegistry } from "./slot-outlet"
import { registerExtensionMessages } from "@hermes-x/i18n"
import type { DiscoveredExtension } from "./discover"
import { prefixTable } from "./i18n-merge"

/**
 * Boot the renderer side of the extension host: load each renderer
 * bundle (if any), call `activate`, register i18n tables.
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
      for (const locale of ["en", "zh-CN"] as const) {
        const tbl = await ext.loadI18n(locale)
        if (tbl) registerExtensionMessages(locale, prefixTable(manifest.id, tbl))
      }
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

export function useActivityBarItems(): Array<{
  id: string
  iconKey: string
  labelKey: string
  order?: number
}> {
  const reg = useSlotRegistry()
  const [snapshot, setSnapshot] = useState(() => reg.get("activityBar.item"))
  useEffect(() => {
    const sub = reg.subscribe(() => setSnapshot(reg.get("activityBar.item")))
    return () => sub.dispose()
  }, [reg])
  return snapshot.map((e) => {
    const props = (e.props ?? {}) as { iconKey?: string; labelKey?: string; order?: number }
    return {
      id: e.entryId,
      iconKey: props.iconKey ?? "",
      labelKey: props.labelKey ?? "",
      order: props.order ?? e.order,
    }
  })
}
