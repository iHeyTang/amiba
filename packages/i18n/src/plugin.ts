import { useMemo, useSyncExternalStore } from "react";

import {
  interpolate,
  messagesEpoch,
  resolveMessage,
  subscribeMessages,
  type MessageLanguage,
} from "./messages";
import { useT, type MessageKey } from "./index";

export type PluginLanguage = MessageLanguage;

// `MessageKey` keeps autocomplete/typo-checking for the (currently large)
// set of still-shared host keys a plugin might reach for, while `string &
// {}` (rather than plain `string`) keeps that autocomplete alive instead of
// widening the union to `string` and losing it. See the `usePluginT` doc
// comment below for why plugin-local keys are intentionally NOT part of
// `MessageKey`.
export type PluginTranslateFn = (
  key: MessageKey | (string & {}),
  params?: Record<string, unknown>,
) => string;

/**
 * A plugin's own locale catalog, keyed the same way the host catalogs are
 * (flat `"domain.key"` strings -> template string). Both languages are
 * required so a plugin can't ship an overlay that silently falls back to the
 * host (or to the raw key) for a language it forgot to translate.
 */
export type PluginCatalogOverlay = Record<
  PluginLanguage,
  Record<string, string>
>;

/**
 * Non-hook translation core shared by `usePluginT`. Kept separate from the
 * hook so the overlay-precedence/fallback chain can be unit tested directly
 * (no React render needed) and so any future non-React plugin surface can
 * reuse it without paying for a hook.
 *
 * Resolution order for a given key, highest precedence first:
 *   1. `overlay[language][key]`     — the plugin's own catalog, active language
 *   2. `overlay.en[key]`            — the plugin's own catalog, English fallback
 *   3. the realm's host template    — `./messages.ts`, which is the official
 *                                     namespace binding when a locale service
 *                                     exists and the owners' compile-time
 *                                     catalogs otherwise. Steps 3 and 4 of the
 *                                     old chain (active language, then English)
 *                                     both live inside that resolver now.
 *   4. `key` itself                 — last resort, same as `useT()`
 *
 * Step 3 is where this hook stopped compiling the host catalogs in. The
 * `language` argument is still what the OVERLAY is read at; the host resolver
 * is handed it too, and honours it in the runtime-less case. When the official
 * locale service is the source it reads its own active locale instead — the
 * two agree except for the one observer tick between an official switch and
 * the `<html lang>` projection this hook watches.
 */
export function resolvePluginTemplate(
  key: string,
  language: PluginLanguage,
  overlay?: PluginCatalogOverlay,
): string {
  return (
    overlay?.[language]?.[key] ??
    overlay?.en[key] ??
    resolveMessage(key, language)
  );
}

/**
 * Builds a `t()` function bound to a fixed language + overlay. Exposed
 * alongside `resolvePluginTemplate` for non-hook callers; `usePluginT`
 * itself is a thin `useMemo` wrapper around this.
 */
export function createPluginTranslator(
  language: PluginLanguage,
  overlay?: PluginCatalogOverlay,
): PluginTranslateFn {
  return (key, params) =>
    interpolate(resolvePluginTemplate(key, language, overlay), params);
}

/**
 * Client-safe locale hook for DSH plugins.
 *
 * It shares the host language store, including the official locale service
 * when present. This avoids missing a language change between render and
 * effect subscription while keeping plugins independent from Electron.
 *
 * ## Plugin catalog overlay (M2 mechanism of record)
 *
 * `usePluginT` reads the host vocabulary through the realm's message registry
 * (`./messages.ts`) rather than from compiled-in catalogs — that indirection
 * is what keeps ~82 KB of Amiba copy out of every plugin bundle. That base is
 * fine for the handful of truly shared strings
 * (`common.*`), but the M2 pluginization doctrine is "plugin-local dicts":
 * a plugin's own `options.<domain>.*` strings should live in the plugin,
 * not depend on host keys that get purged once every plugin has migrated
 * (T11). This hook is the escape hatch for that: pass an `overlay` with the
 * plugin's own `{ en, "zh-CN" }` dictionaries and its keys take precedence
 * over the host catalog (see `resolvePluginTemplate` above for the exact
 * fallback order). Overlay keys are typed as `Record<string, string>`
 * (not `MessageKey`) on purpose — they are the plugin's own namespace and
 * are never meant to join the host `MessageKey` union.
 *
 * Callers that don't pass an overlay behave exactly as before (host
 * catalog only) — the parameter is optional and backward compatible.
 *
 * @example
 * ```ts
 * import overlay from "./i18n"; // { en: {...}, "zh-CN": {...} }
 * const { t } = usePluginT(overlay);
 * t("options.skills.dsh.edit"); // resolves from the plugin's own overlay first
 * ```
 */
export function usePluginT(overlay?: PluginCatalogOverlay): {
  t: PluginTranslateFn;
  language: PluginLanguage;
} {
  const { language } = useT();
  // The host dictionary can arrive AFTER this tree mounted (the shell
  // registers its namespace inside `ctx.inject(["locale"], …)`). Keying the
  // memo on the realm's message-registry revision repaints the host-vocabulary
  // labels when it does; without it a plugin that rendered first would keep
  // showing raw `common.*` keys.
  const epoch = useSyncExternalStore(
    subscribeMessages,
    messagesEpoch,
    messagesEpoch,
  );

  const t = useMemo<PluginTranslateFn>(
    () => createPluginTranslator(language, overlay),
    [epoch, language, overlay],
  );

  return { t, language };
}

export type { MessageKey };
