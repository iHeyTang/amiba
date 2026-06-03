import {
  bootRendererExtensions,
  createSlotRegistry,
  discoverRendererExtensions,
  makeRendererHost,
} from "@hermes-x/extension-host/renderer"
import type { RendererHost } from "@hermes-x/extension-api"
import { getPlatform } from "@hermes-x/platform"

const manifestModules = import.meta.glob<{ default: unknown }>(
  "../../../../extensions/*/manifest.json",
)
const rendererModules = import.meta.glob<{ activate: (h: RendererHost) => void | Promise<void> }>(
  "../../../../extensions/*/dist/renderer.js",
)
const i18nModules = import.meta.glob<{ default: Record<string, string> }>(
  "../../../../extensions/*/dist/i18n/*.json",
)

export const slotRegistry = createSlotRegistry()

// Extensions activate exactly once per app session. React 18 Strict Mode
// invokes mount effects twice in dev so this guard is load-bearing — without
// it every extension's `activate()` runs twice and contributes two of each
// slot entry (the visible symptom: two ActivityBar icons for one extension).
let bootPromise: Promise<{ activated: string[]; failed: Array<{ id: string; error: string }> }> | null = null

export function bootExtensions(translate: (k: string, p?: Record<string, unknown>) => string) {
  if (bootPromise) return bootPromise
  bootPromise = runBootExtensions(translate)
  return bootPromise
}

async function runBootExtensions(translate: (k: string, p?: Record<string, unknown>) => string) {
  const { extensions, failed: discoveryFailed } = await discoverRendererExtensions({
    manifestModules,
    rendererModules,
    i18nModules,
  })
  if (discoveryFailed.length) {
    console.warn("[extensions] discovery failures:", discoveryFailed)
  }
  const result = await bootRendererExtensions({
    extensions,
    makeHostFor: (id) =>
      makeRendererHost(id, {
        bridge: window.hermes.extensions,
        slotRegistry,
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
        translate,
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
