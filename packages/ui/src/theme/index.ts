import { getPlatform } from "@amiba/app-runtime/platform"
import { useEffect, useState } from "react"

/**
 * Theme handling for Amiba UI surfaces.
 *
 * Surfaces never paint custom backgrounds — every panel inherits the shadcn
 * HSL tokens defined in `@amiba/ui/styles/tokens.css`, which flip between
 * a light and dark palette. This module decides which palette to apply.
 *
 * Preferences:
 *   - `auto`  → follow the browser / OS `prefers-color-scheme` (default).
 *   - `light` / `dark` → user-pinned override.
 *
 * Legacy `page` (follow active tab) is read as `auto` and overwritten in
 * storage so we don't keep re-normalising on every load.
 */

export type ThemePreference = "auto" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

export const THEME_PREF_STORAGE_KEY = "settings.ui.theme"
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "auto"

function normalizeStoredTheme(v: unknown): ThemePreference {
  if (v === "light" || v === "dark" || v === "auto") return v
  if (v === "page") return "auto"
  return DEFAULT_THEME_PREFERENCE
}

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const r = await getPlatform().storage.get([THEME_PREF_STORAGE_KEY])
    const v = r[THEME_PREF_STORAGE_KEY]
    const normalized = normalizeStoredTheme(v)
    if (v === "page") {
      await getPlatform().storage.set({ [THEME_PREF_STORAGE_KEY]: normalized })
    }
    return normalized
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export async function saveThemePreference(pref: ThemePreference): Promise<void> {
  await getPlatform().storage.set({ [THEME_PREF_STORAGE_KEY]: pref })
}

function startupThemePreference(): ThemePreference {
  if (typeof document === "undefined") return DEFAULT_THEME_PREFERENCE
  const startupTheme = document.documentElement.dataset.startupTheme
  return startupTheme === "light" || startupTheme === "dark"
    ? startupTheme
    : DEFAULT_THEME_PREFERENCE
}

export function useStoredThemePreference() {
  // Desktop injects its already-resolved launch palette into index.html.
  // Starting from it prevents the first React effect from briefly reverting
  // a pinned theme to the OS preference before storage finishes loading.
  const [pref, setPref] = useState<ThemePreference>(startupThemePreference)

  useEffect(() => {
    let mounted = true
    void loadThemePreference().then((p) => {
      if (mounted) setPref(p)
    })
    const unsub = getPlatform().storage.watch([THEME_PREF_STORAGE_KEY], (changes) => {
      const c = changes[THEME_PREF_STORAGE_KEY]
      if (!c || c.newValue === undefined) return
      const n = normalizeStoredTheme(c.newValue)
      setPref(n)
      if (c.newValue === "page") {
        void saveThemePreference("auto")
      }
    })
    return () => {
      mounted = false
      unsub()
    }
  }, [])

  const update = async (p: ThemePreference) => {
    setPref(p)
    await saveThemePreference(p)
  }

  return [pref, update] as const
}

/* ──────────────────────────────────────────────────────────────────────────
 * Accent (brand colour) — an axis orthogonal to light/dark.
 *
 * Each accent only re-points the brand trio (`--primary`,
 * `--primary-foreground`, `--ring`) in `tokens.css`; the neutral palette is
 * shared, so one accent reads correctly on either light or dark. The choice
 * is applied as a single `.accent-<id>` class on `<html>`, alongside the
 * existing `.dark` / `.light` class.
 * ────────────────────────────────────────────────────────────────────────── */

export type AccentPreference = "violet" | "coral" | "cyan" | "lime" | "graphite"

export interface AccentDef {
  id: AccentPreference
  /** Representative hex for the settings swatch picker (display only — the
   *  real colours live in `tokens.css`). */
  swatch: string
}

/** Registry that drives both the CSS class set and the settings picker. */
export const ACCENTS: readonly AccentDef[] = [
  { id: "violet", swatch: "#6D5EF6" },
  { id: "coral", swatch: "#FF5A3C" },
  { id: "cyan", swatch: "#00B8D9" },
  { id: "lime", swatch: "#C4F000" },
  { id: "graphite", swatch: "#3F3F46" },
]

export const ACCENT_PREF_STORAGE_KEY = "settings.ui.accent"
export const DEFAULT_ACCENT_PREFERENCE: AccentPreference = "violet"

const ACCENT_IDS = ACCENTS.map((a) => a.id)

export function normalizeStoredAccent(v: unknown): AccentPreference {
  return (ACCENT_IDS as string[]).includes(v as string)
    ? (v as AccentPreference)
    : DEFAULT_ACCENT_PREFERENCE
}

export async function loadAccentPreference(): Promise<AccentPreference> {
  try {
    const r = await getPlatform().storage.get([ACCENT_PREF_STORAGE_KEY])
    return normalizeStoredAccent(r[ACCENT_PREF_STORAGE_KEY])
  } catch {
    return DEFAULT_ACCENT_PREFERENCE
  }
}

export async function saveAccentPreference(pref: AccentPreference): Promise<void> {
  await getPlatform().storage.set({ [ACCENT_PREF_STORAGE_KEY]: pref })
}

export function useStoredAccentPreference() {
  const [pref, setPref] = useState<AccentPreference>(DEFAULT_ACCENT_PREFERENCE)

  useEffect(() => {
    let mounted = true
    void loadAccentPreference().then((p) => {
      if (mounted) setPref(p)
    })
    const unsub = getPlatform().storage.watch([ACCENT_PREF_STORAGE_KEY], (changes) => {
      const c = changes[ACCENT_PREF_STORAGE_KEY]
      if (!c || c.newValue === undefined) return
      setPref(normalizeStoredAccent(c.newValue))
    })
    return () => {
      mounted = false
      unsub()
    }
  }, [])

  const update = async (p: AccentPreference) => {
    setPref(p)
    await saveAccentPreference(p)
  }

  return [pref, update] as const
}

/** Swaps the active `.accent-<id>` class on `<html>`, leaving `.dark` /
 *  `.light` (and anything else) in place. */
export function applyAccentClass(accent: AccentPreference) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  for (const id of ACCENT_IDS) root.classList.remove(`accent-${id}`)
  root.classList.add(`accent-${accent}`)
}

/** Reactive reader of the persisted accent that also keeps `<html>` in sync.
 *  Folded into {@link useResolvedTheme} so every surface gets it for free. */
export function useResolvedAccent(): AccentPreference {
  const [accent] = useStoredAccentPreference()
  useEffect(() => {
    applyAccentClass(accent)
  }, [accent])
  return accent
}

/** Reactive `prefers-color-scheme` reader. Tracks browser/OS changes. */
export function useBrowserTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return "light"
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const m = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setTheme(m.matches ? "dark" : "light")
    m.addEventListener("change", onChange)
    return () => m.removeEventListener("change", onChange)
  }, [])

  return theme
}

/**
 * Reads the palette currently applied to `<html>` and re-renders whenever it
 * flips. Use this from leaf components (e.g. CodeMirror) that just need to
 * pick a matching theme — the entry point is already responsible for calling
 * {@link useResolvedTheme} to set the class.
 */
export function useDocumentTheme(): ResolvedTheme {
  const read = (): ResolvedTheme => {
    if (typeof document === "undefined") return "light"
    const cl = document.documentElement.classList
    if (cl.contains("dark")) return "dark"
    if (cl.contains("light")) return "light"
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return "light"
  }

  const [theme, setTheme] = useState<ResolvedTheme>(read)

  useEffect(() => {
    if (typeof document === "undefined") return
    const update = () => setTheme(read())
    update()

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"]
    })

    const m =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null
    m?.addEventListener("change", update)

    return () => {
      observer.disconnect()
      m?.removeEventListener("change", update)
    }
  }, [])

  return theme
}

export function applyThemeClass(theme: ResolvedTheme) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.classList.toggle("light", theme === "light")
  // Official plugins use this selector, including content portaled to body.
  // Amiba still owns the preference and palette; no official theme is mounted.
  document.body?.toggleAttribute("data-ds-dark-theme", theme === "dark")
}

/**
 * Resolves the theme to apply for this surface. Side-effect: syncs the
 * `dark` / `light` class on `<html>` so CSS variables update accordingly.
 */
export function useResolvedTheme(): {
  theme: ResolvedTheme
  preference: ThemePreference
} {
  const [pref] = useStoredThemePreference()
  const browser = useBrowserTheme()
  // Apply the accent class on the same entry hook so every surface that
  // already calls useResolvedTheme() gets the brand colour with no extra wiring.
  useResolvedAccent()

  const resolved: ResolvedTheme = pref === "light" ? "light" : pref === "dark" ? "dark" : browser

  useEffect(() => {
    applyThemeClass(resolved)
  }, [resolved])

  return { theme: resolved, preference: pref }
}
