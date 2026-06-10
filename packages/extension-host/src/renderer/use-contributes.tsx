/**
 * Manifest-driven hooks for desktop UI.
 *
 * All hooks read `window.hermes.extensions.listManifests()` and re-fetch
 * whenever `onExtensionsChanged` fires. They never import extension bundles;
 * the manifest alone drives all UI contributions.
 */

import { useEffect, useState } from "react"
import { getCurrentLanguage, subscribeLanguage } from "@amiba/i18n"
import type { ExtensionManifest } from "@amiba/extension-api"

// ---------------------------------------------------------------------------
// Internal manifest entry type (what listManifests now returns)
// ---------------------------------------------------------------------------

type ManifestEntry = { manifest: ExtensionManifest; path: string }

// ---------------------------------------------------------------------------
// Module-level base URL cache
// ---------------------------------------------------------------------------

/**
 * Shared promise for the extension HTTP server base URL.  Resolved once per
 * renderer process lifetime; all hooks re-use the same fetch.
 */
let _baseUrlPromise: Promise<string> | null = null

function getBaseUrl(): Promise<string> {
  if (!_baseUrlPromise) {
    const bridge = (window as unknown as { hermes: { extensions: { getHttpBaseUrl(): Promise<string> } } }).hermes.extensions
    _baseUrlPromise = bridge.getHttpBaseUrl()
  }
  return _baseUrlPromise
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface MainContribution {
  /** extensionId doubles as ActivityBar item id + activity view id */
  extensionId: string
  /** Lucide icon name */
  icon: string
  /** Already resolved for current language */
  label: string
  /** http://localhost:<port>/extensions/<id>/<view> */
  viewUrl: string
  order: number
}

export interface SettingsContribution {
  /** extensionId doubles as settings tab id */
  extensionId: string
  /** Lucide icon name or null */
  icon: string | null
  /** Already resolved for current language */
  label: string
  viewUrl: string
  order: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type HermesWindowShape = {
  extensions: {
    listManifests(): Promise<ManifestEntry[]>
    onExtensionsChanged(cb: (extensionId: string | null) => void): () => void
    getHttpBaseUrl(): Promise<string>
  }
}

function getExtensionsBridge(): HermesWindowShape["extensions"] {
  return (window as unknown as { hermes: HermesWindowShape }).hermes.extensions
}

/**
 * Build an `http://127.0.0.1:<port>` URL for an extension view HTML file.
 *
 * URL shape: `<baseUrl>/extensions/<extensionId>/<view>`
 *
 * The extensionId is URL-encoded so it round-trips safely through the path.
 * The webview preload extracts the id from `location.pathname`.
 */
function buildViewUrl(baseUrl: string, extensionId: string, view: string): string {
  // Strip any leading slash from the relative view path.
  const normalView = view.replace(/^\//, "").replace(/\\/g, "/")
  return `${baseUrl}/extensions/${encodeURIComponent(extensionId)}/${normalView}`
}

function pickLabel(labels: Record<string, string>, language: string, fallback: string): string {
  return labels[language] ?? labels["en"] ?? fallback
}

function useCurrentLanguage(): string {
  const [lang, setLang] = useState<string>(() => getCurrentLanguage())
  useEffect(() => {
    setLang(getCurrentLanguage())
    return subscribeLanguage((next) => setLang(next))
  }, [])
  return lang
}

function useManifests(): ManifestEntry[] {
  const [entries, setEntries] = useState<ManifestEntry[]>([])

  useEffect(() => {
    const bridge = getExtensionsBridge()
    let cancelled = false

    const load = () => {
      void bridge.listManifests().then((m) => {
        if (!cancelled) setEntries(m)
      })
    }

    load()
    const unsub = bridge.onExtensionsChanged(() => load())
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  return entries
}

/**
 * Resolves the extension HTTP server base URL once per renderer process
 * lifetime.  Re-renders the component when the URL becomes available
 * (typically within the first render cycle — the IPC round-trip is fast).
 */
function useHttpBaseUrl(): string | null {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getBaseUrl().then((url) => {
      if (!cancelled) setBaseUrl(url)
    })
    return () => { cancelled = true }
  }, [])

  return baseUrl
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/**
 * Returns one entry per extension that declares `contributes.main`.
 * Each entry becomes an ActivityBar icon + a full-screen main panel.
 * Sorted ascending by `order` (default 100).
 */
export function useExtensionMains(): MainContribution[] {
  const entries = useManifests()
  const language = useCurrentLanguage()
  const baseUrl = useHttpBaseUrl()

  return entries
    .flatMap(({ manifest: m }) => {
      const main = m.contributes?.main
      if (!main) return []
      return [{
        extensionId: m.id,
        icon: main.icon,
        label: pickLabel(main.labels, language, m.id),
        viewUrl: baseUrl ? buildViewUrl(baseUrl, m.id, main.view) : "",
        order: main.order ?? 100,
      }]
    })
    .sort((a, b) => a.order - b.order)
}

/**
 * Returns one entry per extension that declares `contributes.settings`.
 * Each entry becomes a row in the Settings → EXTENSIONS sidebar group.
 * Sorted ascending by `order` (default 100).
 */
export function useExtensionSettings(): SettingsContribution[] {
  const entries = useManifests()
  const language = useCurrentLanguage()
  const baseUrl = useHttpBaseUrl()

  return entries
    .flatMap(({ manifest: m }) => {
      const settings = m.contributes?.settings
      if (!settings) return []
      return [{
        extensionId: m.id,
        icon: settings.icon ?? null,
        label: pickLabel(settings.labels, language, m.id),
        viewUrl: baseUrl ? buildViewUrl(baseUrl, m.id, settings.view) : "",
        order: settings.order ?? 100,
      }]
    })
    .sort((a, b) => a.order - b.order)
}
