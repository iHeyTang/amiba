import { reasoningLabels } from "./reasoning-labels.js";
import type { PluginCatalogOverlay } from "@amiba/ui/plugin";

/**
 * Plugin-local i18n catalog for `DshComposerModelPicker` (M2b overlay
 * pattern; exemplar: `plugins/dsh-plugin-skills/src/client/i18n.ts`). The
 * overlay is passed to `usePluginT` and its keys take precedence over the
 * host catalog.
 *
 * Scope: exactly the keys the composer picker component itself calls —
 * `sidepanel.modelPicker.label` / `.loadFailed` / `.reasoningEffort`. The
 * rest of the `sidepanel.modelPicker.*` family belongs to the shared
 * `ModelPickerDialog` in `@amiba/ui` and stays host-side (MP-T4 owns the
 * host-key purge). Values copied verbatim from the host catalogs
 * (the host catalogs) at migration time.
 *
 * NOTE: deliberately NOT named `i18n.ts` — a parallel migration owns that
 * filename for the settings surface's dictionary.
 */
export const pickerI18n: PluginCatalogOverlay = {
  en: {
    ...reasoningLabels.en,
    "sidepanel.modelPicker.label": "Choose model",
    "sidepanel.modelPicker.loadFailed":
      "Couldn’t load models. Reopen to retry.",
    "sidepanel.modelPicker.reasoningEffort": "Reasoning effort",
  },
  "zh-CN": {
    ...reasoningLabels["zh-CN"],
    "sidepanel.modelPicker.label": "选择模型",
    "sidepanel.modelPicker.loadFailed": "模型加载失败，重新打开即可重试。",
    "sidepanel.modelPicker.reasoningEffort": "推理强度",
  },
};
