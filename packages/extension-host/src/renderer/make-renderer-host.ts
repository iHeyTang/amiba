// packages/extension-host/src/renderer/make-renderer-host.ts
import type { Disposable, RendererHost, SlotEntry, SlotName } from "@hermes-x/extension-api"
import type { SlotRegistry } from "./slot-registry"
import type { ExtensionsBridge } from "../preload/index"

export interface RendererHostDeps {
  bridge: ExtensionsBridge
  slotRegistry: SlotRegistry
  /** Reads/writes the shared platform settings store. */
  settings: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
    watch(key: string, cb: (v: unknown) => void): () => void
  }
  /** Current language code (e.g. "en", "zh-CN"). Read synchronously. */
  getLanguage: () => string
  /** Subscribe to language changes. Returns an unsubscribe callback. */
  subscribeLanguage: (cb: (lang: string) => void) => () => void
  /** notify dispatcher (toast / banner). */
  notify: (kind: "info" | "warn" | "error", message: string) => void
  /** Hermes-agent tool caller (mirror of the main side). */
  callTool: (tool: string, args: unknown) => Promise<unknown>
  /**
   * Per-extension disposable tracking array. The loader passes in a fresh
   * array for each extension so that unloadExtension() can dispose exactly
   * this extension's slot registrations, settings pages, and watch handles.
   */
  disposables: Disposable[]
}

export function makeRendererHost(extensionId: string, deps: RendererHostDeps): RendererHost {
  const tag = `[ext:${extensionId}]`
  const log =
    (level: "log" | "warn" | "error" | "debug") =>
    (...args: unknown[]) =>
      console[level](tag, ...args)

  return {
    id: extensionId,
    logger: { debug: log("debug"), info: log("log"), warn: log("warn"), error: log("error") },
    slots: {
      register<P>(slot: SlotName, component: React.ComponentType<P>, options?: { slotEntryId?: string; order?: number; props?: Partial<P> }) {
        const entry: SlotEntry<P> = {
          extensionId,
          entryId: options?.slotEntryId ?? `${extensionId}:${slot}`,
          order: options?.order ?? 100,
          component,
          props: options?.props,
        }
        const d = deps.slotRegistry.register(slot, entry)
        deps.disposables.push(d)
        return d
      },
    },
    commands: {
      register: () => ({ dispose: () => undefined }),
      invoke: async () => undefined,
    },
    settings: {
      define: () => ({ dispose: () => undefined }),
      get: <T,>(key: string, fallback: T) =>
        deps.settings.get<T>(`ext.${extensionId}.${key}`, fallback),
      set: (key, value) => deps.settings.set(`ext.${extensionId}.${key}`, value),
      watch: <T,>(key: string, cb: (v: T) => void) => {
        const unsub = deps.settings.watch(`ext.${extensionId}.${key}`, (v) => cb(v as T))
        return { dispose: unsub }
      },
      registerPage: (opts) => {
        // Settings pages route through the same slot registry as other UI
        // contributions — that keeps the underlying machinery uniform — but
        // we expose a dedicated API so extension authors don't have to know
        // the slot name and the host UI can render them in a separate group.
        const d = deps.slotRegistry.register("settings.tab", {
          extensionId,
          entryId: opts.id,
          order: opts.order ?? 100,
          component: opts.component,
          props: { labels: opts.labels, icon: opts.icon },
        })
        deps.disposables.push(d)
        return d
      },
    },
    storage: {
      get: <T,>(key: string, fallback: T) =>
        deps.bridge.invoke(extensionId, "__storage.get", { key, fallback }) as Promise<T>,
      set: (key, value) =>
        deps.bridge.invoke(extensionId, "__storage.set", { key, value }) as Promise<void>,
      watch: () => ({ dispose: () => undefined }),
    },
    ipc: {
      invoke: <TArgs, TRet>(channel: string, args: TArgs) =>
        deps.bridge.invoke(extensionId, channel, args) as Promise<TRet>,
    },
    i18n: {
      get language() {
        return deps.getLanguage()
      },
      subscribe(cb) {
        const unsub = deps.subscribeLanguage(cb)
        return { dispose: unsub }
      },
    },
    hermes: { callTool: (tool, args) => deps.callTool(tool, args) },
    notify: (kind, message) => deps.notify(kind, message),
  } as RendererHost
}
