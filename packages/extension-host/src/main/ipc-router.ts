// packages/extension-host/src/main/ipc-router.ts
import { BrowserWindow, dialog, ipcMain, shell, webContents } from "electron"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ExtensionManifest } from "@amiba/extension-api"
import type { ExtensionRegistryItem } from "../shared/registry"
import { validateManifest } from "./discover"
import {
  fetchIndex,
  getIndexUrl,
  installFromRelease,
  resolveRelease,
  type MarketplaceEntry,
} from "./marketplace"
import { addEntry, findEntry } from "./registry-store"
import { uninstallRegisteredExtension } from "./uninstall-extension"
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
  getRegistryInventory: () => ExtensionRegistryItem[]
  getI18n: (
    extensionId: string,
    locale: "en" | "zh-CN",
  ) => Promise<Record<string, string>>
}) {
  ipcMain.handle("extensions:list", () => opts.getManifestEntries())
  ipcMain.handle("extensions:registry", () => opts.getRegistryInventory())
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

  /**
   * Backing implementation of `hermes.chat.startSession({ text })`
   * from `@amiba/extension-api`. Hand a prompt off to the main
   * desktop window's chat surface and pass control back.
   *
   * The actual orchestration runs in the renderer because session
   * lifecycle (`sessions.createNew()`) is React-state-bound — only the
   * renderer can mint the new session, activate it, AND ensure the
   * subsequent `home.pendingPrompt` drain lands on that session's id.
   * Doing the storage write from main blindly would deliver the prompt
   * to whatever stale session happened to be active (or to no session
   * at all), which is what made the v1 implementation land the user on
   * the empty home view instead of a freshly-spawned chat.
   *
   * So the main side here is intentionally tiny: validate the payload,
   * broadcast `ui:chat-start-session` with the text, and let the
   * renderer's handler do `createNew → queueChatPrompt → flip view`
   * in the right order.
   *
   * Returns a boolean so callers can react if the host rejects the
   * payload (currently only happens on shape validation failure).
   */
  ipcMain.handle(
    "webview:chat-start-session",
    async (_e, payload: unknown): Promise<boolean> => {
      if (!payload || typeof payload !== "object") return false
      const text = (payload as { text?: unknown }).text
      if (typeof text !== "string" || !text.trim()) return false
      for (const wc of webContents.getAllWebContents()) {
        try {
          wc.send("ui:chat-start-session", { text })
        } catch {
          /* ignore — only the main window has the listener */
        }
      }
      return true
    },
  )

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
    if (!findEntry(opts.registryPath, extensionId)) {
      return { ok: false, error: `extension ${extensionId} is not registered` }
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
    const result = await uninstallRegisteredExtension({
      registryPath: opts.registryPath,
      extensionsRoot: opts.extensionsRoot,
      extensionId,
      getManifests: opts.getManifests,
      unloadExtension: opts.unloadExtension,
    })
    if (result.ok) broadcastExtensionsChanged(extensionId)
    return result
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
