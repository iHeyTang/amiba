import { getPlatform } from "@amiba/app-runtime/platform";
import { useCallback, useEffect, useMemo, useState } from "react";

import { en, type MessageKey } from "./en";
import { zhCN } from "./zh-CN";

/**
 * Runtime i18n for Amiba UI surfaces.
 *
 * Storage and React-hook conventions mirror `theme.ts`:
 *   - `auto`     → match `navigator.language` (default).
 *   - `en`       → English.
 *   - `zh-CN`    → Simplified Chinese.
 *
 * `useT()` returns a `t(key, params?)` function bound to the active locale.
 * Components re-render automatically when the user picks a new language.
 *
 * Persistence is delegated to the active desktop PlatformAdapter.
 */

export type LanguagePreference = "auto" | "en" | "zh-CN";
export type ResolvedLanguage = "en" | "zh-CN";

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

function detectBrowserLanguage(): ResolvedLanguage {
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

export function resolveLanguage(pref: LanguagePreference): ResolvedLanguage {
  if (pref === "en" || pref === "zh-CN") return pref;
  return detectBrowserLanguage();
}

export async function loadLanguagePreference(): Promise<LanguagePreference> {
  try {
    const r = await getPlatform().storage.get([LANG_PREF_STORAGE_KEY]);
    return normalizeStoredLang(r[LANG_PREF_STORAGE_KEY]);
  } catch {
    return DEFAULT_LANGUAGE_PREFERENCE;
  }
}

export async function saveLanguagePreference(
  pref: LanguagePreference,
): Promise<void> {
  await getPlatform().storage.set({ [LANG_PREF_STORAGE_KEY]: pref });
}

export function useStoredLanguagePreference() {
  const [pref, setPref] = useState<LanguagePreference>(
    DEFAULT_LANGUAGE_PREFERENCE,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadLanguagePreference().then((p) => {
      if (!mounted) return;
      setPref(p);
      setLoaded(true);
    });
    const unsub = getPlatform().storage.watch(
      [LANG_PREF_STORAGE_KEY],
      (changes) => {
        const c = changes[LANG_PREF_STORAGE_KEY];
        if (!c || c.newValue === undefined) return;
        setPref(normalizeStoredLang(c.newValue));
        setLoaded(true);
      },
    );
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const update = useCallback(async (p: LanguagePreference) => {
    setPref(p);
    setLoaded(true);
    await saveLanguagePreference(p);
  }, []);

  return [pref, update, loaded] as const;
}

function useBrowserLanguage(): ResolvedLanguage {
  const [lang] = useState<ResolvedLanguage>(() => detectBrowserLanguage());
  return lang;
}

function readDocumentLanguage(): ResolvedLanguage | null {
  if (typeof document === "undefined") return null;
  const declared = document.documentElement.lang.toLowerCase();
  if (declared.startsWith("zh")) return "zh-CN";
  if (declared.startsWith("en")) return "en";
  return null;
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
  preference: LanguagePreference;
} {
  const [pref, , preferenceLoaded] = useStoredLanguagePreference();
  const browser = useBrowserLanguage();

  // A newly-mounted page must inherit the language that already governs the
  // document. Its own asynchronous storage read must never publish the
  // default `auto` preference as a transient, potentially different locale.
  const language: ResolvedLanguage = preferenceLoaded
    ? resolveLanguage(pref)
    : (readDocumentLanguage() ?? browser);

  useEffect(() => {
    if (!preferenceLoaded) return;
    // DSH Client plugins render in the official Web Shell React tree, outside
    // Amiba's React providers. The document language is the deliberately tiny
    // cross-root locale contract they can observe without importing a desktop
    // PlatformAdapter or reaching back into the host tree.
    if (document.documentElement.lang !== language) {
      document.documentElement.lang = language;
    }
  }, [language, preferenceLoaded]);

  const t = useMemo<TranslateFn>(() => {
    const catalog = CATALOG[language] ?? en;
    return (key, params) => {
      const template = catalog[key] ?? en[key] ?? key;
      return interpolate(template, params);
    };
  }, [language]);

  return { t, language, preference: pref };
}

// ---------------------------------------------------------------------------
// Non-React language subscription
// ---------------------------------------------------------------------------
//
// Extensions live outside the React tree at boot time (their `activate(host)`
// runs once, host then re-uses the registrations across renders). They need a
// plain JS handle to "what language are we in?" plus a way to react when the
// user changes it. The host wires these into `host.i18n.{language, subscribe}`.
//
// We mirror the storage key into a module-level variable and forward
// `getPlatform().storage.watch(...)` events to subscribers. The first
// subscriber bootstraps the storage read; later ones piggy-back.

type LanguageSubscriber = (lang: ResolvedLanguage) => void;

let cachedLanguage: ResolvedLanguage = detectBrowserLanguage();
const languageSubscribers = new Set<LanguageSubscriber>();
let bootstrapped: Promise<void> | null = null;

function bootstrapLanguageMirror(): Promise<void> {
  if (bootstrapped) return bootstrapped;
  bootstrapped = (async () => {
    const pref = await loadLanguagePreference();
    const lang = resolveLanguage(pref);
    if (lang !== cachedLanguage) {
      cachedLanguage = lang;
      for (const cb of languageSubscribers) cb(cachedLanguage);
    }
    getPlatform().storage.watch([LANG_PREF_STORAGE_KEY], (changes) => {
      const c = changes[LANG_PREF_STORAGE_KEY];
      if (!c) return;
      const next = resolveLanguage(normalizeStoredLang(c.newValue));
      if (next === cachedLanguage) return;
      cachedLanguage = next;
      for (const cb of languageSubscribers) cb(cachedLanguage);
    });
  })();
  return bootstrapped;
}

export function getCurrentLanguage(): ResolvedLanguage {
  return cachedLanguage;
}

export function subscribeLanguage(cb: LanguageSubscriber): () => void {
  void bootstrapLanguageMirror();
  languageSubscribers.add(cb);
  return () => {
    languageSubscribers.delete(cb);
  };
}

export type { MessageKey } from "./en";
