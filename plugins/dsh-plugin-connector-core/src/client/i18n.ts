import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshSettingsConnect`.
 *
 * M2 doctrine: a plugin owns its own strings instead of depending on the
 * host catalogs. Same mechanism as the exemplar
 * `plugins/dsh-plugin-skills/src/client/i18n.ts` (and connector-core's
 * sibling `plugins/dsh-plugin-messaging-core/src/client/i18n.ts`) — the
 * overlay is passed to `usePluginT` and its keys take precedence over the
 * host catalog.
 *
 * Task 6 registers only a placeholder page, so only the placeholder key
 * exists so far; Task 7 (the real `DshSettingsConnect` UI) adds the rest.
 */
export const connectI18n: PluginCatalogOverlay = {
  en: {
    "options.connect.dsh.placeholder":
      "Connect settings are coming soon.",
  },
  "zh-CN": {
    "options.connect.dsh.placeholder": "连接设置即将推出。",
  },
};
