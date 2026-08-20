import { getPlatform } from "@amiba/app-runtime/platform";
import { useMemo, useSyncExternalStore } from "react";

import { en, type MessageKey } from "./en";
import { zhCN } from "./zh-CN";

/**
 * Runtime i18n for Amiba UI surfaces.
 *
 * ## Who decides the language
 *
 * The OFFICIAL DSH locale service does, wherever one exists. Amiba used to
 * own a second, competing preference (`settings.ui.language`, an
 * `auto | en | zh-CN` tri-state persisted through the PlatformAdapter) with
 * its own row in Appearance settings. Once Amiba declared
 * `settings.general.item`, `@deepseek-ai/dsh-client-locale` put its own
 * Language row on the same page and the product showed TWO 语言 controls that
 * did not agree. The official one won: it is the service the whole DSH plugin
 * ecosystem's `t` seat already reads, so a second authority could only ever
 * mean "official copy and Amiba copy disagree".
 *
 * There are therefore exactly two cases, and a caller tells them apart with
 * {@link hasOfficialLocale}:
 *
 *  1. **A DSH client runtime is present.** Whoever owns the plugin context
 *     (today `@amiba/dsh-plugin-ui-shell`) calls {@link installOfficialLocale}
 *     with the official `LocaleRuntime`'s `getSnapshot`/`subscribe` pair. That
 *     source is then AUTHORITATIVE: `useT` re-renders synchronously on every
 *     official switch, and the resolved language is mirrored onto
 *     `document.documentElement.lang` so the surfaces that cannot see this
 *     module instance still follow (see below).
 *  2. **No plugin runtime** — Quick-Ask, the notifier window, the browser
 *     surfaces. Nothing installs a source, and the language resolves from the
 *     document contract, falling back to `navigator.language`. Those entries
 *     publish that fallback once via {@link seedDocumentLanguage} so the
 *     window carries a truthful `lang` attribute from its first paint.
 *
 * ## Why `document.documentElement.lang` is still load-bearing
 *
 * Every plugin bundle is built separately and therefore carries its OWN copy
 * of this module's state; `installOfficialLocale` in the ui-shell bundle can
 * never reach them. The document `lang` attribute is the deliberately tiny
 * cross-realm projection of the active language: the realm holding the
 * official source publishes it, and every other realm (this module's
 * MutationObserver, and `./plugin.ts`'s `usePluginT`) observes it.
 *
 * `useT()` returns a `t(key, params?)` function bound to the active language.
 */

export type ResolvedLanguage = "en" | "zh-CN";

/**
 * The official locale identifiers, exactly as
 * `@deepseek-ai/dsh-client-locale` ships them (`LOCALE_IDS = ["zh", "en"]`,
 * `lib/types/locale-settings.d.ts:8`). Restated structurally because this
 * package is platform-agnostic — it is imported by Quick-Ask and by browser
 * surfaces that have no `@deepseek-ai/*` dependency at all. The tie to the
 * official union is a compile-time probe in the one package that DOES have
 * that dependency: see `OfficialLocaleIdMatchesUpstream` in
 * `plugins/dsh-plugin-ui-shell/src/client/locale-bridge.ts`.
 */
export type OfficialLocaleId = "zh" | "en";

/**
 * Amiba's language tag for an official locale id. Total by construction: the
 * primary subtag decides, the same way the official plugin's own
 * `detectBrowserLocale` matches a browser tag against its shipped locales
 * (`zh-Hans-CN` -> zh, `en-GB` -> en), so an id Amiba has never seen lands on
 * English rather than throwing inside a render.
 */
export function fromOfficialLocaleId(id: string): ResolvedLanguage {
  return id.toLowerCase().split("-")[0] === "zh" ? "zh-CN" : "en";
}

/**
 * The official locale id for an Amiba language tag — the ONLY value that may
 * ever be handed to `LocaleRuntime.setLocale`, which throws on an
 * unregistered id (`locale "<id>" is not registered`). The return type is the
 * official union, so Amiba's own `zh-CN` cannot leak through this function
 * without a compile error.
 */
export function toOfficialLocaleId(language: ResolvedLanguage): OfficialLocaleId {
  return language === "zh-CN" ? "zh" : "en";
}

/** The half of the official `LocaleSnapshot` this package consumes. */
export interface OfficialLocaleSnapshot {
  /** Active locale id (`"zh"` or `"en"`). */
  readonly active: string;
}

/**
 * The official locale service as Amiba consumes it: structurally the
 * LocaleFace `getSnapshot`/`subscribe` pair that `LocaleRuntime` publishes
 * (and that `ctx.slots.installLocale` consumes for the framework `t` seat).
 * Amiba reads the same snapshot the official Language row reads.
 */
export interface OfficialLocaleSource {
  getSnapshot(): OfficialLocaleSnapshot;
  subscribe(onChange: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Legacy preference — retained ONLY for the one-time migration
// ---------------------------------------------------------------------------
//
// `settings.ui.language` has no writer left in the product. The single
// remaining reader is the migration in the ui-shell locale bridge, which
// carries a pre-existing `en` / `zh-CN` choice over to the official service
// once and then stamps the key back to `auto`. `auto` is the value that needs
// no migration (it always meant "follow the browser", which is exactly what
// the official service does while nothing has been chosen), so writing it is
// both the truthful new state and the marker that the migration is done.

/** @deprecated Retained for the one-time migration only. */
export type LanguagePreference = "auto" | "en" | "zh-CN";

export const LANG_PREF_STORAGE_KEY = "settings.ui.language";
export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "auto";

const CATALOG: Record<ResolvedLanguage, Record<string, string>> = {
  en: { ...en },
  "zh-CN": { ...zhCN },
};

function normalizeStoredLang(v: unknown): LanguagePreference {
  if (v === "en" || v === "zh-CN" || v === "auto") return v;
  return DEFAULT_LANGUAGE_PREFERENCE;
}

/** Read the retired preference. Migration only — nothing else may consult it. */
export async function loadLanguagePreference(): Promise<LanguagePreference> {
  try {
    const r = await getPlatform().storage.get([LANG_PREF_STORAGE_KEY]);
    return normalizeStoredLang(r[LANG_PREF_STORAGE_KEY]);
  } catch {
    return DEFAULT_LANGUAGE_PREFERENCE;
  }
}

/**
 * Stamp the retired preference back to `auto`, which is simultaneously the
 * truthful post-migration state and the "already migrated" marker: a later
 * launch reads `auto`, finds nothing to carry over, and leaves the official
 * selection alone.
 */
export async function markLanguagePreferenceMigrated(): Promise<void> {
  await getPlatform().storage.set({
    [LANG_PREF_STORAGE_KEY]: DEFAULT_LANGUAGE_PREFERENCE,
  });
}

// ---------------------------------------------------------------------------
// The language mirror
// ---------------------------------------------------------------------------

/**
 * The browser's own language, matched on the primary subtag. This is the
 * no-runtime fallback, and it is deliberately the same derivation the official
 * plugin performs for its provisional locale.
 */
export function detectBrowserLanguage(): ResolvedLanguage {
  if (typeof navigator === "undefined") return "en";
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);
  for (const raw of candidates) {
    const tag = String(raw).toLowerCase();
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

function readDocumentLanguage(): ResolvedLanguage | null {
  if (typeof document === "undefined") return null;
  const declared = document.documentElement.lang.toLowerCase();
  if (declared.startsWith("zh")) return "zh-CN";
  if (declared.startsWith("en")) return "en";
  return null;
}

type LanguageSubscriber = (language: ResolvedLanguage) => void;

let officialSource: OfficialLocaleSource | null = null;
let officialUnsubscribe: (() => void) | null = null;
const languageSubscribers = new Set<LanguageSubscriber>();
const storeSubscribers = new Set<() => void>();

function resolveActiveLanguage(): ResolvedLanguage {
  const source = officialSource;
  if (source) return fromOfficialLocaleId(source.getSnapshot().active);
  return readDocumentLanguage() ?? detectBrowserLanguage();
}

let cachedLanguage: ResolvedLanguage = resolveActiveLanguage();

function publishDocumentLanguage(language: ResolvedLanguage): void {
  if (typeof document === "undefined") return;
  if (document.documentElement.lang === language) return;
  document.documentElement.lang = language;
}

function refreshLanguage(): void {
  // The realm that owns the official source is the one that PUBLISHES the
  // cross-realm document contract; every other realm only observes it.
  if (officialSource) publishDocumentLanguage(resolveActiveLanguage());
  const next = resolveActiveLanguage();
  if (next === cachedLanguage) return;
  cachedLanguage = next;
  for (const listener of [...storeSubscribers]) listener();
  for (const listener of [...languageSubscribers]) listener(next);
}

// Started eagerly, not on first subscription: a realm whose document language
// is published before its first `useT` mount would otherwise render one frame
// of a stale snapshot.
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  new MutationObserver(refreshLanguage).observe(document.documentElement, {
    attributeFilter: ["lang"],
    attributes: true,
  });
}

/** True when this realm holds the official locale source (case 1 of the two). */
export function hasOfficialLocale(): boolean {
  return officialSource !== null;
}

/**
 * Adopt the official DSH locale service as the authority for Amiba's own UI
 * copy. Called once per realm by whoever owns a DSH client context; the
 * returned disposer restores the no-runtime resolution.
 */
export function installOfficialLocale(source: OfficialLocaleSource): () => void {
  officialUnsubscribe?.();
  officialSource = source;
  officialUnsubscribe = source.subscribe(refreshLanguage);
  refreshLanguage();
  return () => {
    if (officialSource !== source) return;
    officialUnsubscribe?.();
    officialUnsubscribe = null;
    officialSource = null;
    refreshLanguage();
  };
}

/**
 * Publish the no-runtime fallback into the document contract. Entry points of
 * windows that never boot a DSH plugin graph (Quick-Ask, the notifier) call
 * this before mounting so their `<html lang>` stops being the index.html
 * literal. A no-op once an official source is installed.
 */
export function seedDocumentLanguage(): ResolvedLanguage {
  if (!officialSource) publishDocumentLanguage(detectBrowserLanguage());
  refreshLanguage();
  return cachedLanguage;
}

/** The active language, outside React. */
export function getCurrentLanguage(): ResolvedLanguage {
  return cachedLanguage;
}

/** Observe the active language, outside React. */
export function subscribeLanguage(cb: LanguageSubscriber): () => void {
  languageSubscribers.add(cb);
  return () => {
    languageSubscribers.delete(cb);
  };
}

function subscribeLanguageStore(onStoreChange: () => void): () => void {
  storeSubscribers.add(onStoreChange);
  return () => {
    storeSubscribers.delete(onStoreChange);
  };
}

function languageStoreSnapshot(): ResolvedLanguage {
  return cachedLanguage;
}

function interpolate(template: string, params?: Record<string, unknown>) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}

export type TranslateFn = (
  key: MessageKey,
  params?: Record<string, unknown>,
) => string;

export function useT(): {
  t: TranslateFn;
  language: ResolvedLanguage;
} {
  const language = useSyncExternalStore(
    subscribeLanguageStore,
    languageStoreSnapshot,
    languageStoreSnapshot,
  );

  const t = useMemo<TranslateFn>(() => {
    const catalog = CATALOG[language] ?? en;
    return (key, params) => {
      const template = catalog[key] ?? en[key] ?? key;
      return interpolate(template, params);
    };
  }, [language]);

  return { t, language };
}

export type { MessageKey } from "./en";
