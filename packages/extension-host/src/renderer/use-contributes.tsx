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
  /** Full hermes-ext:// URL pointing at the HTML page. */
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
    listManifests(): Promise<ExtensionManifest[]>
    onExtensionsChanged(cb: (extensionId: string | null) => void): () => void
  }
}

function getExtensionsBridge(): HermesWindowShape["extensions"] {
  return (window as unknown as { hermes: HermesWindowShape }).hermes.extensions
}

function viewUrl(extensionId: string, view: string): string {
  // view may already be prefixed or start with a slash — normalise.
  const normalised = view.replace(/^\//, "")
  return `hermes-ext://${extensionId}/${normalised}`
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

function useManifests(): ExtensionManifest[] {
  const [manifests, setManifests] = useState<ExtensionManifest[]>([])

  useEffect(() => {
    const bridge = getExtensionsBridge()
    let cancelled = false

    const load = () => {
      void bridge.listManifests().then((m) => {
        if (!cancelled) setManifests(m)
      })
    }

    load()
    const unsub = bridge.onExtensionsChanged(() => load())
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  return manifests
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

export function useActivityBarItems(): ActivityBarItem[] {
  const manifests = useManifests()
  const language = useCurrentLanguage()

  return manifests.flatMap((m) =>
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
  const manifests = useManifests()

  return manifests.flatMap((m) =>
    (m.contributes?.sidebarViews ?? []).map((sv) => ({
      id: sv.id,
      extensionId: m.id,
      anchor: sv.anchor,
      viewUrl: viewUrl(m.id, sv.view),
    })),
  )
}

export function useExtensionSettingsTabs(): SettingsTabContribution[] {
  const manifests = useManifests()
  const language = useCurrentLanguage()

  return manifests.flatMap((m) =>
    (m.contributes?.settingsTabs ?? []).map((tab) => ({
      id: tab.id,
      extensionId: m.id,
      label: pickLabel(tab.labels, language, tab.id),
      icon: tab.icon,
      viewUrl: viewUrl(m.id, tab.view),
      order: tab.order ?? 100,
    })),
  )
}

export function useComposerHints(): ComposerHintContribution[] {
  const manifests = useManifests()

  return manifests.flatMap((m) =>
    (m.contributes?.composerHints ?? []).map((hint) => ({
      id: hint.id,
      extensionId: m.id,
      viewUrl: viewUrl(m.id, hint.view),
    })),
  )
}
