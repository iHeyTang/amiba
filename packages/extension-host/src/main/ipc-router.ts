// packages/extension-host/src/main/ipc-router.ts
import { dialog, ipcMain } from "electron"
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionManifest } from "@hermes-x/extension-api"
import { validateManifest } from "./discover"

export type ChannelHandler = (
  args: unknown,
  ctx: { windowId: number | null },
) => Promise<unknown> | unknown

export function createChannelTable() {
  const table = new Map<string, ChannelHandler>()
  return {
    register(full: string, h: ChannelHandler) {
      if (table.has(full)) throw new Error(`duplicate channel: ${full}`)
      table.set(full, h)
      return { dispose: () => table.delete(full) }
    },
    invoke(full: string, args: unknown, windowId: number | null) {
      const h = table.get(full)
      if (!h) throw new Error(`no handler for ${full}`)
      return Promise.resolve(h(args, { windowId }))
    },
    has(full: string) {
      return table.has(full)
    },
  }
}

/**
 * The renderer talks to extensions through a single bridge channel
 * `ext-invoke`. The bridge resolves the (extensionId, channel) tuple
 * to the full `ext.<id>.<channel>` form the extension registered.
 * This keeps the preload surface small and prevents renderer code from
 * faking another extension's id at the IPC layer.
 */
export function registerInvokeRouter(
  channelTable: ReturnType<typeof createChannelTable>,
  getManifests: () => ExtensionManifest[],
) {
  ipcMain.handle(
    "ext-invoke",
    async (
      event,
      payload: { extensionId?: string; channel?: string; args?: unknown },
    ) => {
      const { extensionId, channel, args } = payload ?? {}
      if (typeof extensionId !== "string" || typeof channel !== "string") {
        throw new Error("ext-invoke: extensionId and channel required")
      }
      if (!getManifests().some((m) => m.id === extensionId)) {
        throw new Error(`unknown extension: ${extensionId}`)
      }
      return channelTable.invoke(
        `ext.${extensionId}.${channel}`,
        args,
        event.sender?.id ?? null,
      )
    },
  )
}

export function registerStatusChannel(
  getRegistry: () => Array<{ id: string; status: string; error?: string }>,
): void {
  ipcMain.handle("extensions:status", () => getRegistry())
}

/**
 * Bridge for listManifests + i18n + bundle path.
 */
export function registerMetadataChannels(opts: {
  getManifests: () => ExtensionManifest[]
  getI18n: (
    extensionId: string,
    locale: "en" | "zh-CN",
  ) => Promise<Record<string, string>>
  getRendererBundleUrl: (extensionId: string) => Promise<string | null>
}) {
  ipcMain.handle("extensions:list", () => opts.getManifests())
  ipcMain.handle(
    "extensions:i18n",
    async (
      _e,
      payload: { extensionId: string; locale: "en" | "zh-CN" },
    ) => opts.getI18n(payload.extensionId, payload.locale),
  )
  ipcMain.handle(
    "extensions:renderer-bundle-url",
    async (_e, extensionId: string) =>
      opts.getRendererBundleUrl(extensionId),
  )
}

/**
 * Register the sideload / reload / uninstall / folder-picker IPC handlers.
 *
 * Must be called AFTER `bootMainExtensionHost` returns so that
 * `reloadExtension` and `unloadExtension` are available.
 */
export function registerExtensionActionChannels(opts: {
  extensionsDir: string
  getManifests: () => ExtensionManifest[]
  reloadExtension: (id: string) => Promise<void>
  unloadExtension: (id: string) => Promise<void>
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
   * extensions:sideload — symlinks `<extensionsDir>/<id>/` → `folderPath`
   * then reloads the extension into the running host.
   */
  ipcMain.handle("extensions:sideload", async (_e, folderPath: string) => {
    if (typeof folderPath !== "string" || !folderPath) {
      return { ok: false, error: "folderPath is required" }
    }

    // Validate the manifest in the provided folder.
    const manifestPath = join(folderPath, "manifest.json")
    if (!existsSync(manifestPath)) {
      return { ok: false, error: `no valid manifest at ${folderPath}` }
    }
    let manifestId: string
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8"))
      const v = validateManifest(raw)
      if (!v.ok) return { ok: false, error: `no valid manifest at ${folderPath}: ${v.error}` }
      manifestId = v.manifest.id
    } catch (e) {
      return { ok: false, error: `failed to read manifest: ${e instanceof Error ? e.message : String(e)}` }
    }

    const targetLink = join(opts.extensionsDir, manifestId)
    if (existsSync(targetLink)) {
      return { ok: false, error: `an extension with id ${manifestId} is already installed` }
    }

    try {
      symlinkSync(folderPath, targetLink, "dir")
    } catch (e) {
      return { ok: false, error: `failed to create symlink: ${e instanceof Error ? e.message : String(e)}` }
    }

    // Trigger a reload — the host will read the manifest fresh from targetLink.
    try {
      await opts.reloadExtension(manifestId)
    } catch (e) {
      return { ok: false, error: `symlinked but failed to activate: ${e instanceof Error ? e.message : String(e)}` }
    }

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
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * extensions:uninstall — unload and delete (or unlink) the extension directory.
   */
  ipcMain.handle("extensions:uninstall", async (_e, extensionId: string) => {
    if (typeof extensionId !== "string") {
      return { ok: false, error: "extensionId is required" }
    }
    if (!opts.getManifests().some((m) => m.id === extensionId)) {
      return { ok: false, error: `extension ${extensionId} is not loaded` }
    }

    try {
      await opts.unloadExtension(extensionId)
    } catch (e) {
      return { ok: false, error: `failed to unload: ${e instanceof Error ? e.message : String(e)}` }
    }

    const extPath = join(opts.extensionsDir, extensionId)
    try {
      // If it's a symlink, just unlink it (don't follow into the source tree).
      let isSym = false
      try { isSym = lstatSync(extPath).isSymbolicLink() } catch { /* path not found — nothing to remove */ }
      if (isSym) {
        const { unlinkSync } = await import("node:fs")
        unlinkSync(extPath)
      } else if (existsSync(extPath)) {
        rmSync(extPath, { recursive: true, force: true })
      }
    } catch (e) {
      return { ok: false, error: `unloaded but failed to remove directory: ${e instanceof Error ? e.message : String(e)}` }
    }

    return { ok: true }
  })
}
