// packages/extension-host/src/main/index.ts
import { join } from "node:path"
import { readFileSync } from "node:fs"
import type { Disposable, ExtensionManifest } from "@hermes-x/extension-api"
import { activateMainExtensions } from "./activate"
import { createExtensionRegistry } from "./registry"
import {
  broadcastExtensionsChanged,
  createChannelTable,
  registerExtensionActionChannels,
  registerInvokeRouter,
  registerMarketplaceChannels,
  registerMetadataChannels,
  registerStatusChannel,
  registerWebViewChannels,
} from "./ipc-router"
import { makeMainHost } from "./make-main-host"
import { createExtensionStorage } from "./storage-fs"
import { validateManifest } from "./discover"
import { watchManifests } from "./manifest-watcher"
import { discoverFromRegistry } from "./discover-registry"
import { findEntry } from "./registry-store"

export interface MainBootOptions {
  /**
   * Absolute path to the extensions registry JSON file.
   * (e.g. `<userData>/extensions-registry.json`)
   */
  registryPath: string
  /**
   * Absolute path to the root directory where marketplace installs land.
   * (e.g. `<userData>/extensions/`)
   */
  extensionsRoot: string
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
  /**
   * Returns the current UI language code (e.g. "en" or "zh-CN").
   * Used by the webview bridge for `webview:get-state`.
   */
  getLanguage?: () => string
  /**
   * Returns the current UI theme ("light" or "dark").
   * Used by the webview bridge for `webview:get-state`.
   */
  getTheme?: () => string
  /**
   * Absolute path to the compiled webview-bridge preload bundle.
   * Used by the webview bridge for `webview:preload-path`.
   */
  webviewBridgePath?: string
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

  // Discover extensions from registry.
  const { entries: discovered, failed: discoveryFailed } = discoverFromRegistry(opts.registryPath)
  if (discoveryFailed.length) {
    console.warn("[extensions] registry discovery failures:", discoveryFailed)
  }

  // Mutable manifests list — mutated on reload.
  const manifestEntries: Array<{ manifest: ExtensionManifest; rootDir: string; source: "marketplace" | "local" }> = discovered.map(
    (e) => ({ manifest: e.manifest, rootDir: e.rootDir, source: e.source }),
  )
  const getManifests = () => manifestEntries.map((m) => m.manifest)

  // Per-extension disposable tracking: extensionId → Disposable[]
  const extDisposables = new Map<string, Disposable[]>()

  registerInvokeRouter(channelTable, getManifests)
  registerMetadataChannels({
    getManifests,
    getI18n: opts.getI18n,
  })

  // Register webview bridge IPC channels (language/theme state, settings,
  // and preload path). These are only wired when the host is told about
  // them; desktop passes the paths/getters; plain unit tests omit them.
  if (opts.webviewBridgePath) {
    registerWebViewChannels({
      getLanguage: opts.getLanguage ?? (() => "en"),
      getTheme: opts.getTheme ?? (() => "dark"),
      webviewBridgePath: opts.webviewBridgePath,
      settingsStore: opts.settingsStore,
    })
  }
  registerStatusChannel(() =>
    registry.list().map((e) => ({
      id: e.id,
      status: e.status,
      error: e.error,
      source: manifestEntries.find((m) => m.manifest.id === e.id)?.source,
    })),
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
          const full = join(e.rootDir, mainRel)
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
      // If not in manifestEntries, try to find path from registry.
      const regEntry = findEntry(opts.registryPath, id)
      if (!regEntry) {
        console.warn(`[extension-host] reloadExtension: unknown id ${id}`)
        return
      }
      // Re-read the manifest from the registry-recorded path.
      try {
        const raw = JSON.parse(readFileSync(join(regEntry.path, "manifest.json"), "utf8"))
        const v = validateManifest(raw)
        if (!v.ok) {
          console.error(`[extension-host] reloadExtension: invalid manifest for ${id}: ${v.error}`)
          return
        }
        const newEntry = { manifest: v.manifest, rootDir: regEntry.path, source: regEntry.source }
        manifestEntries.push(newEntry)
        await activateOne(newEntry)
        if (watcher) {
          watcher.setExtensionPaths(buildPathMap())
        }
      } catch (e) {
        console.error(`[extension-host] reloadExtension: failed to reload ${id}:`, e)
      }
      return
    }
    // Snapshot rootDir and source before unload removes it from manifestEntries.
    const { rootDir, source } = existingEntry
    await unloadExtension(id)

    // Re-read the manifest from disk (it may have changed).
    try {
      const raw = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"))
      const v = validateManifest(raw)
      if (!v.ok) {
        console.error(`[extension-host] reloadExtension: invalid manifest for ${id}: ${v.error}`)
        return
      }
      // Re-check source from registry in case it changed.
      const regEntry2 = findEntry(opts.registryPath, id)
      const newEntry = { manifest: v.manifest, rootDir, source: regEntry2?.source ?? source }
      manifestEntries.push(newEntry)
      await activateOne(newEntry)
      // Re-arm the watcher with the updated path map.
      if (watcher) {
        watcher.setExtensionPaths(buildPathMap())
      }
    } catch (e) {
      console.error(`[extension-host] reloadExtension: failed to reload ${id}:`, e)
    }
  }

  /**
   * Re-read the registry and activate any newly registered extensions that are
   * not yet in manifestEntries. Called after a marketplace install completes.
   */
  async function reloadExtensions(): Promise<void> {
    const { entries: fresh } = discoverFromRegistry(opts.registryPath)
    const knownIds = new Set(manifestEntries.map((m) => m.manifest.id))
    for (const e of fresh) {
      if (knownIds.has(e.manifest.id)) continue
      // New extension: register and activate.
      const entry = { manifest: e.manifest, rootDir: e.rootDir, source: e.source }
      manifestEntries.push(entry)
      await activateOne(entry)
      if (watcher) {
        watcher.setExtensionPaths(buildPathMap())
      }
    }
  }

  /** Build current id→rootDir map for the watcher. */
  function buildPathMap(): Map<string, string> {
    return new Map(manifestEntries.map((e) => [e.manifest.id, e.rootDir]))
  }

  /**
   * Allow IPC router to push a new in-memory manifest entry (for add-local
   * before the extension is activated).
   */
  function addManifestEntry(manifest: ExtensionManifest, rootDir: string): void {
    if (!manifestEntries.some((e) => e.manifest.id === manifest.id)) {
      // Source will be determined from the registry when reloadExtension runs.
      const regEntry = findEntry(opts.registryPath, manifest.id)
      manifestEntries.push({ manifest, rootDir, source: regEntry?.source ?? "local" })
    }
  }

  // Register add-local / reload / uninstall / folder-picker IPC channels.
  registerExtensionActionChannels({
    registryPath: opts.registryPath,
    extensionsRoot: opts.extensionsRoot,
    getManifests,
    reloadExtension,
    unloadExtension,
    addManifestEntry,
  })

  // Register marketplace IPC channels.
  registerMarketplaceChannels({
    extensionsRoot: opts.extensionsRoot,
    registryPath: opts.registryPath,
    reloadExtensions,
  })

  // Start manifest mtime watcher.
  // On change, trigger reloadExtension — this is the hot-reload path.
  let watcher: ReturnType<typeof watchManifests> | undefined
  const initialPaths = buildPathMap()
  watcher = watchManifests(initialPaths, (changedId) => {
    console.info(`[extension-host] manifest changed for ${changedId} — hot reloading…`)
    void reloadExtension(changedId).then(
      () => broadcastExtensionsChanged(changedId),
      (e) => {
        console.error(`[extension-host] hot reload failed for ${changedId}:`, e)
      },
    )
  })

  return {
    registry,
    unloadExtension,
    reloadExtension,
    shutdown: async () => {
      watcher?.stop()
      await Promise.allSettled([...shutdown].map((h) => Promise.resolve(h())))
    },
  }
}

export { activateMainExtensions } from "./activate"
export { validateManifest } from "./discover"
export { discoverFromRegistry } from "./discover-registry"
export type { DiscoveredEntry } from "./discover-registry"
export { loadRegistry, saveRegistry, addEntry, removeEntry, findEntry } from "./registry-store"
export type { RegistryEntry, Registry, ExtensionSource } from "./registry-store"
