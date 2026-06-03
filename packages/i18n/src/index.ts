import { getPlatform } from "@hermes-x/platform"
import { useCallback, useEffect, useMemo, useState } from "react"

import { en, type MessageKey } from "./en"
import { zhCN } from "./zh-CN"

/**
 * Runtime i18n for Hermes UI surfaces.
 *
 * Storage and React-hook conventions mirror `theme.ts`:
 *   - `auto`     → match `navigator.language` (default).
 *   - `en`       → English.
 *   - `zh-CN`    → Simplified Chinese.
 *
 * `useT()` returns a `t(key, params?)` function bound to the active locale.
 * Components re-render automatically when the user picks a new language.
 *
 * Persistence is delegated to the active PlatformAdapter, so this module is
 * the same in extension (chrome.storage) and desktop (Electron IPC store).
 */

export type LanguagePreference = "auto" | "en" | "zh-CN"
export type ResolvedLanguage = "en" | "zh-CN"

export const LANG_PREF_STORAGE_KEY = "settings.ui.language"
export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "auto"

const CATALOG: Record<ResolvedLanguage, Record<string, string>> = {
  en: { ...en },
  "zh-CN": { ...zhCN },
}

function normalizeStoredLang(v: unknown): LanguagePreference {
  if (v === "en" || v === "zh-CN" || v === "auto") return v
  return DEFAULT_LANGUAGE_PREFERENCE
}

function detectBrowserLanguage(): ResolvedLanguage {
  if (typeof navigator === "undefined") return "en"
  const candidates = [...(navigator.languages ?? []), navigator.language].filter(Boolean)
  for (const raw of candidates) {
    const tag = String(raw).toLowerCase()
    if (tag.startsWith("zh")) return "zh-CN"
    if (tag.startsWith("en")) return "en"
  }
  return "en"
}

export function resolveLanguage(pref: LanguagePreference): ResolvedLanguage {
  if (pref === "en" || pref === "zh-CN") return pref
  return detectBrowserLanguage()
}

export async function loadLanguagePreference(): Promise<LanguagePreference> {
  try {
    const r = await getPlatform().storage.get([LANG_PREF_STORAGE_KEY])
    return normalizeStoredLang(r[LANG_PREF_STORAGE_KEY])
  } catch {
    return DEFAULT_LANGUAGE_PREFERENCE
  }
}

export async function saveLanguagePreference(pref: LanguagePreference): Promise<void> {
  await getPlatform().storage.set({ [LANG_PREF_STORAGE_KEY]: pref })
}

export function useStoredLanguagePreference() {
  const [pref, setPref] = useState<LanguagePreference>(DEFAULT_LANGUAGE_PREFERENCE)

  useEffect(() => {
    let mounted = true
    void loadLanguagePreference().then((p) => {
      if (mounted) setPref(p)
    })
    const unsub = getPlatform().storage.watch([LANG_PREF_STORAGE_KEY], (changes) => {
      const c = changes[LANG_PREF_STORAGE_KEY]
      if (!c || c.newValue === undefined) return
      setPref(normalizeStoredLang(c.newValue))
    })
    return () => {
      mounted = false
      unsub()
    }
  }, [])

  const update = useCallback(async (p: LanguagePreference) => {
    setPref(p)
    await saveLanguagePreference(p)
  }, [])

  return [pref, update] as const
}

function useBrowserLanguage(): ResolvedLanguage {
  const [lang] = useState<ResolvedLanguage>(() => detectBrowserLanguage())
  return lang
}

function interpolate(template: string, params?: Record<string, unknown>) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k]
    return v === undefined || v === null ? `{${k}}` : String(v)
  })
}

export type TranslateFn = (key: MessageKey, params?: Record<string, unknown>) => string

export function useT(): {
  t: TranslateFn
  language: ResolvedLanguage
  preference: LanguagePreference
} {
  const [pref] = useStoredLanguagePreference()
  const browser = useBrowserLanguage()

  const language: ResolvedLanguage = pref === "en" || pref === "zh-CN" ? pref : browser

  const t = useMemo<TranslateFn>(() => {
    const catalog = CATALOG[language] ?? en
    return (key, params) => {
      const template = catalog[key] ?? en[key] ?? key
      return interpolate(template, params)
    }
  }, [language])

  return { t, language, preference: pref }
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

type LanguageSubscriber = (lang: ResolvedLanguage) => void

let cachedLanguage: ResolvedLanguage = detectBrowserLanguage()
const languageSubscribers = new Set<LanguageSubscriber>()
let bootstrapped: Promise<void> | null = null

function bootstrapLanguageMirror(): Promise<void> {
  if (bootstrapped) return bootstrapped
  bootstrapped = (async () => {
    const pref = await loadLanguagePreference()
    const lang = resolveLanguage(pref)
    if (lang !== cachedLanguage) {
      cachedLanguage = lang
      for (const cb of languageSubscribers) cb(cachedLanguage)
    }
    getPlatform().storage.watch([LANG_PREF_STORAGE_KEY], (changes) => {
      const c = changes[LANG_PREF_STORAGE_KEY]
      if (!c) return
      const next = resolveLanguage(normalizeStoredLang(c.newValue))
      if (next === cachedLanguage) return
      cachedLanguage = next
      for (const cb of languageSubscribers) cb(cachedLanguage)
    })
  })()
  return bootstrapped
}

export function getCurrentLanguage(): ResolvedLanguage {
  return cachedLanguage
}

export function subscribeLanguage(cb: LanguageSubscriber): () => void {
  void bootstrapLanguageMirror()
  languageSubscribers.add(cb)
  return () => {
    languageSubscribers.delete(cb)
  }
}

export type { MessageKey } from "./en"
