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
  /** Full file:// URL pointing at the HTML page (includes ?_ext=<id>). */
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
  }
}

function getExtensionsBridge(): HermesWindowShape["extensions"] {
  return (window as unknown as { hermes: HermesWindowShape }).hermes.extensions
}

/**
 * Build a `file://` URL for an extension view HTML file, appending
 * `?_ext=<extensionId>` so the webview preload can identify the extension
 * without relying on `location.hostname` (which is empty for file:// URLs).
 *
 * NOTE: On Windows, absolute paths use backslashes. We normalise them to
 * forward slashes for the URL. Full Windows path-to-URL handling (drive
 * letters, UNC paths) is a TODO — this project targets macOS/Linux for v1.
 */
function buildViewUrl(rootPath: string, view: string, extensionId: string): string {
  // Normalise: strip leading slash from view, convert backslashes
  const normalView = view.replace(/^\//, "").replace(/\\/g, "/")
  const normalRoot = rootPath.replace(/\\/g, "/")
  const abs = `${normalRoot}/${normalView}`
  const url = new URL(`file://${abs}`)
  url.searchParams.set("_ext", extensionId)
  return url.toString()
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

  return entries.flatMap(({ manifest: m, path }) =>
    (m.contributes?.sidebarViews ?? []).map((sv) => ({
      id: sv.id,
      extensionId: m.id,
      anchor: sv.anchor,
      viewUrl: buildViewUrl(path, sv.view, m.id),
    })),
  )
}

export function useExtensionSettingsTabs(): SettingsTabContribution[] {
  const entries = useManifests()
  const language = useCurrentLanguage()

  return entries.flatMap(({ manifest: m, path }) =>
    (m.contributes?.settingsTabs ?? []).map((tab) => ({
      id: tab.id,
      extensionId: m.id,
      label: pickLabel(tab.labels, language, tab.id),
      icon: tab.icon,
      viewUrl: buildViewUrl(path, tab.view, m.id),
      order: tab.order ?? 100,
    })),
  )
}

export function useComposerHints(): ComposerHintContribution[] {
  const entries = useManifests()

  return entries.flatMap(({ manifest: m, path }) =>
    (m.contributes?.composerHints ?? []).map((hint) => ({
      id: hint.id,
      extensionId: m.id,
      viewUrl: buildViewUrl(path, hint.view, m.id),
    })),
  )
}
