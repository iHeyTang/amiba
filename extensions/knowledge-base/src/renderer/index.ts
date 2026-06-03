import type { RendererActivate } from "@hermes-x/extension-api"
import enCatalog from "../i18n/en.json"
import zhCNCatalog from "../i18n/zh-CN.json"
import { makeKnowledgePanel } from "./views/KnowledgePanel"
import { makeSettingsKnowledgeTab } from "./views/SettingsKnowledgeTab"
import { makeBrainDisconnectedHint } from "./views/BrainDisconnectedHint"

/**
 * Look up `key` in each catalog and return a `{ en, "zh-CN" }` shape so the
 * host UI (ActivityBar item label, Settings tab label) can pick the locale
 * at render time without owning the extension's translation table.
 */
function localize(key: string): Record<string, string> {
  return {
    en: (enCatalog as Record<string, string>)[key] ?? key,
    "zh-CN": (zhCNCatalog as Record<string, string>)[key] ?? key,
  }
}

export const activate: RendererActivate = (host) => {
  // ActivityBar item — metadata-only entry; ActivityBar consumes icon/label
  // from props via useActivityBarItems() and re-resolves on language change.
  host.slots.register(
    "activityBar.item",
    () => null,
    {
      slotEntryId: "knowledge",
      order: 200,
      props: {
        icon: "book-open",
        labels: localize("activityBar.label"),
      },
    },
  )

  host.slots.register(
    "sidebar.view",
    makeKnowledgePanel(host),
    { slotEntryId: "knowledge", order: 100 },
  )

  host.slots.register(
    "settings.tab",
    makeSettingsKnowledgeTab(host),
    {
      slotEntryId: "knowledge",
      order: 100,
      props: { labels: localize("settings.label") },
    },
  )

  host.slots.register(
    "composer.hint",
    makeBrainDisconnectedHint(host),
    { slotEntryId: "brain-disconnected", order: 100 },
  )
}
