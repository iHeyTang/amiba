/**
 * Manifest-driven hooks for desktop UI.
 *
 * All hooks read `window.hermes.extensions.listManifests()` and re-fetch
 * whenever `onExtensionsChanged` fires. They never import extension bundles;
 * the manifest alone drives all UI contributions.
 */

import { useEffect, useState } from "react"
import { getCurrentLanguage, subscribeLanguage } from "@hermes-x/i18n"
import type { ExtensionManifest } from "@hermes-x/extension-api"

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

export interface ActivityBarItem {
  id: string
  extensionId: string
  icon: string
  label: string
  order: number
}

export interface SidebarViewContribution {
  id: string
  extensionId: string
  anchor: string
  /** Full http://127.0.0.1:<port>/extensions/<id>/... URL. */
  viewUrl: string
}

export interface SettingsTabContribution {
  id: string
  extensionId: string
  label: string
  icon?: string
  viewUrl: string
  order: number
}

export interface ComposerHintContribution {
  id: string
  extensionId: string
  viewUrl: string
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

export function useActivityBarItems(): ActivityBarItem[] {
  const entries = useManifests()
  const language = useCurrentLanguage()

  return entries.flatMap(({ manifest: m }) =>
    (m.contributes?.activityBar ?? []).map((item) => ({
      id: item.id,
      extensionId: m.id,
      icon: item.icon,
      label: pickLabel(item.labels, language, item.id),
      order: item.order ?? 100,
    })),
  )
}

export function useSidebarViews(): SidebarViewContribution[] {
  const entries = useManifests()
  const baseUrl = useHttpBaseUrl()

  return entries.flatMap(({ manifest: m }) =>
    (m.contributes?.sidebarViews ?? []).map((sv) => ({
      id: sv.id,
      extensionId: m.id,
      anchor: sv.anchor,
      viewUrl: baseUrl ? buildViewUrl(baseUrl, m.id, sv.view) : "",
    })),
  )
}

export function useExtensionSettingsTabs(): SettingsTabContribution[] {
  const entries = useManifests()
  const language = useCurrentLanguage()
  const baseUrl = useHttpBaseUrl()

  return entries.flatMap(({ manifest: m }) =>
    (m.contributes?.settingsTabs ?? []).map((tab) => ({
      id: tab.id,
      extensionId: m.id,
      label: pickLabel(tab.labels, language, tab.id),
      icon: tab.icon,
      viewUrl: baseUrl ? buildViewUrl(baseUrl, m.id, tab.view) : "",
      order: tab.order ?? 100,
    })),
  )
}

export function useComposerHints(): ComposerHintContribution[] {
  const entries = useManifests()
  const baseUrl = useHttpBaseUrl()

  return entries.flatMap(({ manifest: m }) =>
    (m.contributes?.composerHints ?? []).map((hint) => ({
      id: hint.id,
      extensionId: m.id,
      viewUrl: baseUrl ? buildViewUrl(baseUrl, m.id, hint.view) : "",
    })),
  )
}
