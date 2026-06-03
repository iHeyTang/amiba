// packages/extension-host/src/main/index.ts
import type { ExtensionManifest } from "@hermes-x/extension-api"
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
}

export async function bootMainExtensionHost(
  opts: MainBootOptions,
): Promise<MainBootResult> {
  const channelTable = createChannelTable()
  const storage = createExtensionStorage()
  const registry = createExtensionRegistry()
  const bootBackground = new Set<() => Promise<void> | void>()
  const shutdown = new Set<() => Promise<void> | void>()
  const allManifests = opts.manifests.map((m) => m.manifest)

  registerInvokeRouter(channelTable, () => allManifests)
  registerMetadataChannels({
    getManifests: () => allManifests,
    getI18n: opts.getI18n,
    getRendererBundleUrl: opts.getRendererBundleUrl,
  })
  registerStatusChannel(() =>
    registry.list().map((e) => ({ id: e.id, status: e.status, error: e.error })),
  )

  const result = await activateMainExtensions({
    manifests: allManifests,
    loadMain: async (id) => {
      const entry = opts.manifests.find((m) => m.manifest.id === id)
      if (!entry) throw new Error(`manifest not found for ${id}`)
      const mainRel = entry.manifest.entries.main
      if (!mainRel) throw new Error(`no main entry for ${id}`)
      const full = `${entry.rootDir}/${mainRel}`
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
      }),
  })

  for (const item of result.loaded) {
    const manifest = allManifests.find((m) => m.id === item.id)!
    registry.set({ id: item.id, manifest, status: "loaded" })
  }
  for (const item of result.failed) {
    const manifest = allManifests.find((m) => m.id === item.id)!
    registry.set({ id: item.id, manifest, status: "failed", error: item.error })
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

  return {
    registry,
    shutdown: async () => {
      await Promise.allSettled([...shutdown].map((h) => Promise.resolve(h())))
    },
  }
}

export { activateMainExtensions } from "./activate"
export { validateManifest } from "./discover"
