import type { RendererActivate } from "@hermes-x/extension-api"
import { makeKnowledgePanel } from "./views/KnowledgePanel"
import { makeSettingsKnowledgeTab } from "./views/SettingsKnowledgeTab"
import { makeBrainDisconnectedHint } from "./views/BrainDisconnectedHint"

export const activate: RendererActivate = (host) => {
  // ActivityBar item — uses metadata-only entry (component returns null;
  // ActivityBar reads icon/label from props via useActivityBarItems).
  host.slots.register(
    "activityBar.item",
    () => null,
    {
      slotEntryId: "knowledge",
      order: 200,
      props: {
        iconKey: "book-open",
        labelKey: "ext.io.hermes.knowledge-base.activityBar.label",
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
      props: { labelKey: "ext.io.hermes.knowledge-base.settings.label" },
    },
  )

  host.slots.register(
    "composer.hint",
    makeBrainDisconnectedHint(host),
    { slotEntryId: "brain-disconnected", order: 100 },
  )
}
