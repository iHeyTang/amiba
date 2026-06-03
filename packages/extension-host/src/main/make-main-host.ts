// packages/extension-host/src/main/make-main-host.ts
import type { Disposable, MainHost } from "@hermes-x/extension-api"
import type { createChannelTable } from "./ipc-router"

export interface MainHostDeps {
  channelTable: ReturnType<typeof createChannelTable>
  /** Reads / writes the shared main-process settings store. */
  settingsStore: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  /** Per-extension FS storage rooted under userData/extensions-storage/<id>. */
  storage: {
    get<T>(extensionId: string, key: string, fallback: T): Promise<T>
    set(extensionId: string, key: string, value: unknown): Promise<void>
  }
  /** Hermes-agent tool dispatcher. */
  callTool: (tool: string, args: unknown) => Promise<unknown>
  /** Lifecycle hook registries. */
  bootBackground: Set<() => Promise<void> | void>
  shutdown: Set<() => Promise<void> | void>
  /**
   * Per-extension disposable tracking array. The loader passes in a fresh
   * array for each extension and stores it in the disposable map so that
   * unloadExtension() can tear down exactly this extension's contributions.
   */
  disposables: Disposable[]
}

export function makeMainHost(
  extensionId: string,
  deps: MainHostDeps,
): MainHost {
  const log = (level: string, args: unknown[]) =>
    console[level as "info"](`[ext:${extensionId}]`, ...args)

  return {
    id: extensionId,
    logger: {
      debug: (...a) => log("debug", a),
      info: (...a) => log("info", a),
      warn: (...a) => log("warn", a),
      error: (...a) => log("error", a),
    },
    ipc: {
      expose: (channel, handler) => {
        const fullChannel = `ext.${extensionId}.${channel}`
        const d = deps.channelTable.register(
          fullChannel,
          async (args, ctx) => handler(args as never, ctx),
        ) as Disposable
        deps.disposables.push(d)
        return d
      },
    },
    lifecycle: {
      onBootBackground: (h) => {
        deps.bootBackground.add(h)
        const d: Disposable = { dispose: () => deps.bootBackground.delete(h) }
        deps.disposables.push(d)
        return d
      },
      onShutdown: (h) => {
        deps.shutdown.add(h)
        const d: Disposable = { dispose: () => deps.shutdown.delete(h) }
        deps.disposables.push(d)
        return d
      },
    },
    settings: {
      get: (key, fallback) =>
        deps.settingsStore.get(`ext.${extensionId}.${key}`, fallback),
      set: (key, value) =>
        deps.settingsStore.set(`ext.${extensionId}.${key}`, value),
    },
    storage: {
      get: (key, fallback) => deps.storage.get(extensionId, key, fallback),
      set: (key, value) => deps.storage.set(extensionId, key, value),
    },
    hermes: {
      callTool: (tool, args) =>
        deps.callTool(tool, args) as Promise<unknown>,
    },
  } as MainHost
}
