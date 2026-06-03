import {
  bootRendererExtensions,
  createSlotRegistry,
  makeRendererHost,
} from "@hermes-x/extension-host/renderer"
import type {
  Disposable,
  ExtensionManifest,
  RendererHost,
} from "@hermes-x/extension-api"
import { getCurrentLanguage, subscribeLanguage } from "@hermes-x/i18n"
import { getPlatform } from "@hermes-x/platform"

export const slotRegistry = createSlotRegistry()

type DiscoveredExtension = {
  manifest: ExtensionManifest
  loadRenderer?: () => Promise<{ activate: (h: RendererHost) => void | Promise<void> }>
  loadI18n: (locale: "en" | "zh-CN") => Promise<null>
}

type BootResult = Awaited<ReturnType<typeof bootRendererExtensions>>

// Extensions activate exactly once per app session. React 18 Strict Mode
// invokes mount effects twice in dev so this guard is load-bearing — without
// it every extension's `activate()` runs twice and contributes two of each
// slot entry.
let bootPromise: Promise<BootResult> | null = null
let bootResult: BootResult | null = null

/**
 * Tracks the set of extension ids whose renderer-side `activate` has been
 * called. Used by `syncExtensions` to diff against the current manifest list
 * so we know what to load (new), reload (already active), or unload (gone).
 */
const activatedIds = new Set<string>()

function makeHostFor(id: string, disposables: Disposable[]) {
  return makeRendererHost(id, {
    bridge: window.hermes.extensions,
    slotRegistry,
    disposables,
    settings: {
      get: async <T,>(key: string, fallback: T) => {
        const r = await getPlatform().storage.get([key])
        return ((r[key] as T | undefined) ?? fallback) as T
      },
      set: async (key, value) => getPlatform().storage.set({ [key]: value }),
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
  })
}

/**
 * Resolve the on-disk bundle URL for an extension and wrap it as a
 * DiscoveredExtension that `bootRendererExtensions` / `reloadExtension`
 * understands. Returns `undefined` if the extension declares no renderer
 * entry (pure main-side extensions don't need a renderer activate).
 */
async function buildDiscoveredExt(
  manifest: ExtensionManifest,
): Promise<DiscoveredExtension> {
  const rendererRel = manifest.entries.renderer
  if (!rendererRel) {
    return { manifest, loadRenderer: undefined, loadI18n: async () => null }
  }
  // hermes-ext:// is a custom Electron protocol the main process registers
  // (see apps/desktop/src/main/ext-protocol.ts). It maps to whatever path
  // the registry entry for this extension points at. Chromium blocks
  // file:// loads from the renderer, so we can't import("file://…") here.
  //
  // The `?t=…` cache-bust forces the dynamic import to skip the JS module
  // cache so CLI rebuilds get picked up on every reload.
  const url = `hermes-ext://${manifest.id}/${rendererRel}?t=${Date.now()}`
  return {
    manifest,
    loadRenderer: async () => {
      const mod = await import(/* @vite-ignore */ url)
      return mod as { activate: (h: RendererHost) => void | Promise<void> }
    },
    loadI18n: async () => null,
  }
}

export function bootExtensions() {
  if (bootPromise) return bootPromise
  bootPromise = runBootExtensions()
  return bootPromise
}

async function runBootExtensions(): Promise<BootResult> {
  const manifests = await window.hermes.extensions.listManifests()
  const extensions = await Promise.all(manifests.map(buildDiscoveredExt))

  const result = await bootRendererExtensions({
    extensions,
    makeHostFor,
  })

  bootResult = result
  for (const id of result.activated) activatedIds.add(id)

  if (result.failed.length) {
    console.warn("[extensions] activation failures:", result.failed)
  }

  // Auto-sync on any change pushed from main. extensionId carries the
  // affected extension when known; null falls through to full diff.
  window.hermes.extensions.onExtensionsChanged((extensionId) => {
    void syncExtensions(extensionId).catch((e) => {
      console.warn("[extensions] sync failed:", e)
    })
  })

  return result
}

/**
 * Reconcile the renderer-side state with the main process's current manifest
 * list.
 *
 *  - If `extensionId` is given: just reload that one (used by sideload,
 *    uninstall, CLI hot-reload, marketplace install).
 *  - If `extensionId` is null: scan all manifests; activate new ones,
 *    unload ones that disappeared, reload ones still present.
 *
 * Safe to call before `bootExtensions()` has completed — it queues behind
 * the boot promise.
 */
export async function syncExtensions(extensionId?: string | null): Promise<void> {
  // Make sure boot is done before we try to mutate state.
  await bootExtensions()
  if (!bootResult) return

  const manifests = await window.hermes.extensions.listManifests()
  const presentIds = new Set(manifests.map((m) => m.id))

  if (extensionId) {
    const stillPresent = presentIds.has(extensionId)
    if (!stillPresent) {
      await bootResult.unloadExtension(extensionId)
      activatedIds.delete(extensionId)
      return
    }
    const manifest = manifests.find((m) => m.id === extensionId)
    if (!manifest) return
    const ext = await buildDiscoveredExt(manifest)
    const before = bootResult.failed.length
    await bootResult.reloadExtension(extensionId, ext)
    const newFailures = bootResult.failed.slice(before).filter((f) => f.id === extensionId)
    if (newFailures.length) {
      console.error(
        `[extensions] activate failed for ${extensionId}:`,
        newFailures[0]!.error,
      )
    } else {
      activatedIds.add(extensionId)
      console.info(`[extensions] (re)activated ${extensionId}`)
    }
    return
  }

  // Full diff path (null payload).
  // 1. Unload anything no longer present.
  for (const id of [...activatedIds]) {
    if (!presentIds.has(id)) {
      await bootResult.unloadExtension(id)
      activatedIds.delete(id)
    }
  }
  // 2. Activate or reload each present manifest.
  for (const manifest of manifests) {
    const ext = await buildDiscoveredExt(manifest)
    await bootResult.reloadExtension(manifest.id, ext)
    activatedIds.add(manifest.id)
  }
}
