import type { RendererActivate } from "@hermes-x/extension-api"
import enCatalog from "../i18n/en.json"
import zhCNCatalog from "../i18n/zh-CN.json"
import HelloPanel from "./views/HelloPanel"

/**
 * Look up `key` in each catalog and return a `{ en, "zh-CN" }` shape so the
 * host UI (ActivityBar item label) can pick the locale at render time.
 */
function localize(key: string): Record<string, string> {
  return {
    en: (enCatalog as Record<string, string>)[key] ?? key,
    "zh-CN": (zhCNCatalog as Record<string, string>)[key] ?? key,
  }
}

export const activate: RendererActivate = (host) => {
  // Register the ActivityBar entry (icon + localised label).
  host.slots.register("activityBar.item", () => null, {
    slotEntryId: "main",
    order: 200,
    props: {
      icon: "book-open",
      labels: localize("activityBar.label"),
    },
  })

  // Register the sidebar view that renders when the activity item is selected.
  host.slots.register("sidebar.view", HelloPanel, {
    slotEntryId: "main",
    order: 100,
    props: { host },
  })
}
