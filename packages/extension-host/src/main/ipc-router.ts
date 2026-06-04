// packages/extension-host/src/main/ipc-router.ts
import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ExtensionManifest } from "@hermes-x/extension-api"
import { validateManifest } from "./discover"
import {
  fetchIndex,
  getIndexUrl,
  installFromRelease,
  resolveRelease,
  type MarketplaceEntry,
} from "./marketplace"
import { addEntry, findEntry, removeEntry } from "./registry-store"
import type { createRunnerManagerWithRpc } from "./runner-controller"

type RunnerManager = ReturnType<typeof createRunnerManagerWithRpc>

/**
 * The renderer talks to extensions through a single bridge channel
 * `ext-invoke`. The bridge resolves the (extensionId, channel) tuple
 * and forwards the call to the appropriate utilityProcess runner.
 * This keeps the preload surface small and prevents renderer code from
 * faking another extension's id at the IPC layer.
 */
export function registerInvokeRouter(
  runnerManager: RunnerManager,
  getManifests: () => ExtensionManifest[],
) {
  ipcMain.handle(
    "ext-invoke",
    async (
      _event,
      payload: { extensionId?: string; channel?: string; args?: unknown },
    ) => {
      const { extensionId, channel, args } = payload ?? {}
      if (typeof extensionId !== "string" || typeof channel !== "string") {
        throw new Error("ext-invoke: extensionId and channel required")
      }
      if (!getManifests().some((m) => m.id === extensionId)) {
        throw new Error(`unknown extension: ${extensionId}`)
      }
      return runnerManager.invokeExtensionChannel(extensionId, channel, args)
    },
  )
}

export function registerStatusChannel(
  getRegistry: () => Array<{ id: string; status: string; error?: string; source?: string }>,
): void {
  ipcMain.handle("extensions:status", () => getRegistry())
}

/**
 * Bridge for listManifests + i18n + bundle path.
 */
export function registerMetadataChannels(opts: {
  getManifests: () => ExtensionManifest[]
  getManifestEntries: () => Array<{ manifest: ExtensionManifest; path: string }>
  getI18n: (
    extensionId: string,
    locale: "en" | "zh-CN",
  ) => Promise<Record<string, string>>
}) {
  ipcMain.handle("extensions:list", () => opts.getManifestEntries())
  ipcMain.handle(
    "extensions:i18n",
    async (
      _e,
      payload: { extensionId: string; locale: "en" | "zh-CN" },
    ) => opts.getI18n(payload.extensionId, payload.locale),
  )
}

/**
 * Register IPC channels required by the WebView bridge preload:
 *
 * - `webview:get-state` (sync + async) — returns { language, theme, extensionId }
 *   for a given extensionId. The preload calls this once at startup.
 * - `webview:preload-path` — returns the absolute file:// path of the
 *   webview bridge bundle so the renderer can inject it via the preload attr.
 * - `ext-settings:get` / `ext-settings:set` — namespaced settings access.
 *   The extension's key is prepended with `ext.<id>.` before hitting the store.
 */
export function registerWebViewChannels(opts: {
  /** Returns the current language code, e.g. "en" or "zh-CN". */
  getLanguage: () => string
  /** Returns the current theme, e.g. "light" or "dark". */
  getTheme: () => string
  /** Absolute path to the compiled webview-bridge preload bundle. */
  webviewBridgePath: string
  /** Reads/writes the shared settings store. */
  settingsStore: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
}): void {
  // Synchronous version used by the preload (ipcRenderer.sendSync).
  // Must be registered with ipcMain.on (not handle) for sendSync.
  ipcMain.on(
    "webview:get-state",
    (event, extensionId: string) => {
      event.returnValue = {
        language: opts.getLanguage(),
        theme: opts.getTheme(),
        extensionId: typeof extensionId === "string" ? extensionId : "unknown",
      }
    },
  )

  // Async version as well, for completeness.
  ipcMain.handle("webview:get-state-async", (_e, extensionId: string) => ({
    language: opts.getLanguage(),
    theme: opts.getTheme(),
    extensionId: typeof extensionId === "string" ? extensionId : "unknown",
  }))

  ipcMain.handle("webview:preload-path", () => opts.webviewBridgePath)

  /**
   * Bounce a URL out to the user's default browser. Webviews can't
   * reach the renderer's `shell.openExternal` directly, so this
   * channel proxies the call. Restricted to http(s) to keep extensions
   * from invoking `file://`, `vbscript:`, or other scheme abuses.
   */
  ipcMain.handle("webview:shell-open-external", async (_e, url: unknown) => {
    if (typeof url !== "string") return
    if (!/^https?:\/\//i.test(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle(
    "ext-settings:get",
    async (
      _e,
      payload: { extensionId: string; key: string; fallback: unknown },
    ) => {
      const { extensionId, key, fallback } = payload ?? {}
      if (typeof extensionId !== "string" || typeof key !== "string") return fallback
      return opts.settingsStore.get(`ext.${extensionId}.${key}`, fallback)
    },
  )

  ipcMain.handle(
    "ext-settings:set",
    async (
      _e,
      payload: { extensionId: string; key: string; value: unknown },
    ) => {
      const { extensionId, key, value } = payload ?? {}
      if (typeof extensionId !== "string" || typeof key !== "string") return
      await opts.settingsStore.set(`ext.${extensionId}.${key}`, value)
    },
  )
}

/**
 * Register the add-local / reload / uninstall / folder-picker IPC handlers.
 *
 * Must be called AFTER `bootMainExtensionHost` returns so that
 * `reloadExtension` and `unloadExtension` are available.
 */
export function registerExtensionActionChannels(opts: {
  registryPath: string
  extensionsRoot: string
  getManifests: () => ExtensionManifest[]
  reloadExtension: (id: string) => Promise<void>
  unloadExtension: (id: string) => Promise<void>
  addManifestEntry: (manifest: ExtensionManifest, rootDir: string) => void
}) {
  /**
   * extensions:show-picker — opens a native directory-picker dialog and
   * returns the chosen path or null. Needed because the renderer cannot
   * call Electron's dialog module directly (context isolation).
   */
  ipcMain.handle("extensions:show-picker", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]!
  })

  /**
   * extensions:add-local — adds an entry to the registry pointing at the
   * provided folder path. No file copying or symlinking is done.
   */
  ipcMain.handle("extensions:add-local", async (_e, folderPath: string) => {
    if (typeof folderPath !== "string" || !folderPath) {
      return { ok: false, error: "folderPath is required" }
    }

    // Always resolve to an absolute path.
    const absolutePath = resolve(folderPath)

    // Validate the manifest in the provided folder.
    const manifestPath = join(absolutePath, "manifest.json")
    if (!existsSync(manifestPath)) {
      return { ok: false, error: `no valid manifest at ${absolutePath}` }
    }
    let manifestId: string
    let manifest: ExtensionManifest
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8"))
      const v = validateManifest(raw)
      if (!v.ok) return { ok: false, error: `no valid manifest at ${absolutePath}: ${v.error}` }
      manifestId = v.manifest.id
      manifest = v.manifest
    } catch (e) {
      return { ok: false, error: `failed to read manifest: ${e instanceof Error ? e.message : String(e)}` }
    }

    // Check if id is already registered with a DIFFERENT path.
    const existing = findEntry(opts.registryPath, manifestId)
    if (existing && existing.path !== absolutePath) {
      return {
        ok: false,
        error: `extension ${manifestId} is already registered at a different path: ${existing.path}`,
      }
    }

    // Add registry entry (upsert for same path).
    addEntry(opts.registryPath, {
      id: manifestId,
      source: "local",
      path: absolutePath,
      addedAt: new Date().toISOString(),
    })

    // Add to the in-memory manifest entries if not already present.
    if (!opts.getManifests().some((m) => m.id === manifestId)) {
      opts.addManifestEntry(manifest, absolutePath)
    }

    // Trigger a reload so the host activates the extension.
    try {
      await opts.reloadExtension(manifestId)
    } catch (e) {
      return { ok: false, error: `registered but failed to activate: ${e instanceof Error ? e.message : String(e)}` }
    }

    broadcastExtensionsChanged(manifestId)
    return { ok: true, id: manifestId }
  })

  /**
   * extensions:reload — reload a single extension by id.
   */
  ipcMain.handle("extensions:reload", async (_e, extensionId: string) => {
    if (typeof extensionId !== "string") {
      return { ok: false, error: "extensionId is required" }
    }
    if (!opts.getManifests().some((m) => m.id === extensionId)) {
      return { ok: false, error: `extension ${extensionId} is not loaded` }
    }
    try {
      await opts.reloadExtension(extensionId)
      broadcastExtensionsChanged(extensionId)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * extensions:uninstall — unload the extension, then:
   *   - source=marketplace: delete the directory AND remove registry entry
   *   - source=local: ONLY remove the registry entry, never touch the source dir
   */
  ipcMain.handle("extensions:uninstall", async (_e, extensionId: string) => {
    if (typeof extensionId !== "string") {
      return { ok: false, error: "extensionId is required" }
    }
    if (!opts.getManifests().some((m) => m.id === extensionId)) {
      return { ok: false, error: `extension ${extensionId} is not loaded` }
    }

    // Look up source before unloading.
    const entry = findEntry(opts.registryPath, extensionId)
    const source = entry?.source ?? "marketplace"

    try {
      await opts.unloadExtension(extensionId)
    } catch (e) {
      return { ok: false, error: `failed to unload: ${e instanceof Error ? e.message : String(e)}` }
    }

    if (source === "marketplace") {
      const extPath = join(opts.extensionsRoot, extensionId)
      try {
        if (existsSync(extPath)) {
          rmSync(extPath, { recursive: true, force: true })
        }
      } catch (e) {
        return { ok: false, error: `unloaded but failed to remove directory: ${e instanceof Error ? e.message : String(e)}` }
      }
    }
    // For local: do NOT touch the source directory.

    // Remove registry entry.
    removeEntry(opts.registryPath, extensionId)

    broadcastExtensionsChanged(extensionId)
    return { ok: true }
  })
}

/**
 * Register the `extensions:http-base-url` IPC channel.
 *
 * The renderer calls this once (cached module-level) to discover the
 * loopback port of the extension HTTP server started in main.
 */
export function registerExtHttpChannel(getBaseUrl: () => string): void {
  ipcMain.handle("extensions:http-base-url", () => getBaseUrl())
}

/**
 * Broadcast `extensions:changed` to every open BrowserWindow.
 *
 * `extensionId` carries the affected extension's id when known (sideload,
 * uninstall, reload, manifest hot-reload, marketplace install). The
 * renderer uses it to surgically reload just that one — instead of
 * re-importing every bundle. `null` means "we don't know which one,"
 * which forces the renderer into a full registry diff.
 */
export function broadcastExtensionsChanged(extensionId: string | null = null): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send("extensions:changed", extensionId)
    }
  }
}

/**
 * Register the marketplace IPC channels:
 * - `marketplace:index-url` — returns the current index URL string.
 * - `marketplace:list` — fetches and returns the full marketplace index.
 * - `marketplace:install` — resolves, downloads, and installs an entry, then
 *   triggers a reload and broadcasts `extensions:changed` to all windows.
 */
export function registerMarketplaceChannels(opts: {
  extensionsRoot: string
  registryPath: string
  reloadExtensions: () => Promise<void>
}) {
  ipcMain.handle("marketplace:index-url", () => getIndexUrl())

  ipcMain.handle("marketplace:list", async () => {
    try {
      return { ok: true as const, entries: await fetchIndex() }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

  ipcMain.handle(
    "marketplace:install",
    async (_e, entry: MarketplaceEntry) => {
      try {
        const release = await resolveRelease(entry)
        const manifest = await installFromRelease(release, opts.extensionsRoot, opts.registryPath)
        await opts.reloadExtensions()
        broadcastExtensionsChanged()
        return { ok: true as const, id: manifest.id, version: manifest.version }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    },
  )
}
