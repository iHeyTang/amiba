// packages/extension-host/src/main/ipc-router.ts
import { ipcMain } from "electron"
import type { ExtensionManifest } from "@hermes-x/extension-api"

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
