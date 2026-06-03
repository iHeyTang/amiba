import {
  bootRendererExtensions,
  createSlotRegistry,
  makeRendererHost,
} from "@hermes-x/extension-host/renderer"
import type { RendererHost, Disposable } from "@hermes-x/extension-api"
import { getCurrentLanguage, subscribeLanguage } from "@hermes-x/i18n"
import { getPlatform } from "@hermes-x/platform"

export const slotRegistry = createSlotRegistry()

// Extensions activate exactly once per app session. React 18 Strict Mode
// invokes mount effects twice in dev so this guard is load-bearing — without
// it every extension's `activate()` runs twice and contributes two of each
// slot entry (the visible symptom: two ActivityBar icons for one extension).
let bootPromise: Promise<{ activated: string[]; failed: Array<{ id: string; error: string }> }> | null = null

export function bootExtensions() {
  if (bootPromise) return bootPromise
  bootPromise = runBootExtensions()
  return bootPromise
}

async function runBootExtensions() {
  // Fetch the manifest list from the main process (populated at runtime from
  // <userData>/extensions/ by discoverFromUserData on the main side).
  const manifests = await window.hermes.extensions.listManifests()

  // Build DiscoveredExtension entries dynamically using file:// imports
  // instead of the old compile-time import.meta.glob approach.
  const extensions = await Promise.all(
    manifests.map(async (manifest) => {
      if (!manifest.entries.renderer) {
        return {
          manifest,
          loadRenderer: undefined,
          loadI18n: async (_locale: "en" | "zh-CN") => null,
        }
      }
      // Ask main for the absolute on-disk path of this extension's renderer bundle.
      const bundlePath = await window.hermes.extensions.rendererBundleUrl(manifest.id)
      return {
        manifest,
        loadRenderer: bundlePath
          ? async () => {
              // @vite-ignore — intentional runtime dynamic import; Vite must not
              // try to resolve this at build time (path is unknown until runtime).
              const mod = await import(/* @vite-ignore */ `file://${bundlePath}`)
              return mod as { activate: (h: RendererHost) => void | Promise<void> }
            }
          : undefined,
        loadI18n: async (_locale: "en" | "zh-CN") => null,
      }
    }),
  )

  const result = await bootRendererExtensions({
    extensions,
    makeHostFor: (id: string, disposables: Disposable[]) =>
      makeRendererHost(id, {
        bridge: window.hermes.extensions,
        slotRegistry,
        disposables,
        settings: {
          get: async <T,>(key: string, fallback: T) => {
            const r = await getPlatform().storage.get([key])
            return ((r[key] as T | undefined) ?? fallback) as T
          },
          set: async (key, value) =>
            getPlatform().storage.set({ [key]: value }),
          watch: (key, cb) =>
            getPlatform().storage.watch([key], (changes) => {
              const c = changes[key]
              if (c) cb((c as { newValue?: unknown }).newValue)
            }),
        },
        getLanguage: () => getCurrentLanguage(),
        subscribeLanguage: (cb) => subscribeLanguage(cb),
        notify: (_kind, message) => console.info("[ext notify]", message),
        callTool: async () => {
          throw new Error("hermes.callTool not wired yet (renderer)")
        },
      }),
  })

  if (result.failed.length) {
    console.warn("[extensions] activation failures:", result.failed)
  }
  return result
}
