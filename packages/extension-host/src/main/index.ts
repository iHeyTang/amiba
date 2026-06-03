// packages/extension-host/src/main/index.ts
import type { Disposable, ExtensionManifest } from "@hermes-x/extension-api"
import { activateMainExtensions } from "./activate"
import { createExtensionRegistry } from "./registry"
import {
  createChannelTable,
  registerInvokeRouter,
  registerMetadataChannels,
  registerStatusChannel,
} from "./ipc-router"
import { makeMainHost } from "./make-main-host"
import { createExtensionStorage } from "./storage-fs"

export interface MainBootOptions {
  /** All discovered manifests with their resolved file paths. */
  manifests: Array<{
    manifest: ExtensionManifest
    /** Absolute path of the manifest dir, used to resolve `entries.main`. */
    rootDir: string
  }>
  /** Reads/writes the shared settings store (re-uses desktop's mainStore). */
  settingsStore: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  /** Hermes tool dispatcher (desktop wires its hermes-agent client). */
  callTool: (tool: string, args: unknown) => Promise<unknown>
  /** Async loader for an extension's i18n JSON (per locale). */
  getI18n: (
    extensionId: string,
    locale: "en" | "zh-CN",
  ) => Promise<Record<string, string>>
  /** Returns a `file://` or `app://` URL the renderer can `import()`. */
  getRendererBundleUrl: (extensionId: string) => Promise<string | null>
}

export interface MainBootResult {
  registry: ReturnType<typeof createExtensionRegistry>
  shutdown: () => Promise<void>
  /** Unload a single extension by id (dispose all its registrations + call deactivate). */
  unloadExtension: (id: string) => Promise<void>
  /** Unload then re-activate a single extension by id. */
  reloadExtension: (id: string) => Promise<void>
}

export async function bootMainExtensionHost(
  opts: MainBootOptions,
): Promise<MainBootResult> {
  const channelTable = createChannelTable()
  const storage = createExtensionStorage()
  const registry = createExtensionRegistry()
  const bootBackground = new Set<() => Promise<void> | void>()
  const shutdown = new Set<() => Promise<void> | void>()

  // Mutable manifests list — mutated on reload.
  const manifestEntries = [...opts.manifests]
  const getManifests = () => manifestEntries.map((m) => m.manifest)

  // Per-extension disposable tracking: extensionId → Disposable[]
  const extDisposables = new Map<string, Disposable[]>()

  registerInvokeRouter(channelTable, getManifests)
  registerMetadataChannels({
    getManifests,
    getI18n: opts.getI18n,
    getRendererBundleUrl: opts.getRendererBundleUrl,
  })
  registerStatusChannel(() =>
    registry.list().map((e) => ({ id: e.id, status: e.status, error: e.error })),
  )

  async function activateOne(entry: { manifest: ExtensionManifest; rootDir: string }): Promise<void> {
    const { manifest } = entry
    const disposables: Disposable[] = []
    extDisposables.set(manifest.id, disposables)
    try {
      const result = await activateMainExtensions({
        manifests: [manifest],
        loadMain: async (id) => {
          const e = manifestEntries.find((m) => m.manifest.id === id)
          if (!e) throw new Error(`manifest not found for ${id}`)
          const mainRel = e.manifest.entries.main
          if (!mainRel) throw new Error(`no main entry for ${id}`)
          const full = `${e.rootDir}/${mainRel}`
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require(full) as { activate: (h: unknown) => Promise<void> | void }
        },
        makeHost: (id) =>
          makeMainHost(id, {
            channelTable,
            settingsStore: opts.settingsStore,
            storage,
            callTool: opts.callTool,
            bootBackground,
            shutdown,
            disposables,
          }),
      })
      if (result.loaded.length > 0) {
        registry.set({ id: manifest.id, manifest, status: "loaded" })
      } else if (result.failed.length > 0) {
        registry.set({
          id: manifest.id,
          manifest,
          status: "failed",
          error: result.failed[0]!.error,
        })
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      registry.set({ id: manifest.id, manifest, status: "failed", error })
    }
  }

  // Activate all initial manifests.
  for (const entry of manifestEntries) {
    await activateOne(entry)
  }

  // Fire boot-background hooks in parallel; failures are logged but
  // do NOT downgrade the extension's status.
  void Promise.allSettled(
    [...bootBackground].map((h) =>
      Promise.resolve(h()).catch((e) => {
        console.error("[extension-host] onBootBackground:", e)
      }),
    ),
  )

  async function unloadExtension(id: string): Promise<void> {
    const disposables = extDisposables.get(id)
    if (disposables) {
      for (const d of disposables) {
        try { d.dispose() } catch { /* ignore */ }
      }
      extDisposables.delete(id)
    }
    registry.delete(id)
    // Remove from mutable entries list
    const idx = manifestEntries.findIndex((m) => m.manifest.id === id)
    if (idx !== -1) manifestEntries.splice(idx, 1)
  }

  async function reloadExtension(id: string): Promise<void> {
    // Find the entry before unloading (we need rootDir to re-activate).
    const existingEntry = manifestEntries.find((m) => m.manifest.id === id)
    if (!existingEntry) {
      console.warn(`[extension-host] reloadExtension: unknown id ${id}`)
      return
    }
    // Snapshot rootDir before unload removes it from manifestEntries.
    const { rootDir } = existingEntry
    await unloadExtension(id)

    // Re-read the manifest from disk (it may have changed).
    try {
      const { readFileSync } = await import("node:fs")
      const { join } = await import("node:path")
      const { validateManifest } = await import("./discover")
      const raw = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"))
      const v = validateManifest(raw)
      if (!v.ok) {
        console.error(`[extension-host] reloadExtension: invalid manifest for ${id}: ${v.error}`)
        return
      }
      const newEntry = { manifest: v.manifest, rootDir }
      manifestEntries.push(newEntry)
      await activateOne(newEntry)
    } catch (e) {
      console.error(`[extension-host] reloadExtension: failed to reload ${id}:`, e)
    }
  }

  return {
    registry,
    unloadExtension,
    reloadExtension,
    shutdown: async () => {
      await Promise.allSettled([...shutdown].map((h) => Promise.resolve(h())))
    },
  }
}

export { activateMainExtensions } from "./activate"
export { validateManifest } from "./discover"
export { discoverFromUserData } from "./discover-fs"
export type { DiscoveredEntry } from "./discover-fs"
