import type { ComponentType, ReactNode } from "react"
import type { SlotName, SlotEntry, SlotContext } from "./slots"
import type { SettingsSchema } from "./settings"

export interface Disposable {
  dispose(): void
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface IpcContext {
  /** Numeric id of the BrowserWindow that issued the call, or null for main. */
  windowId: number | null
}

export interface MainHost {
  readonly id: string
  logger: Logger
  ipc: {
    expose<TArgs = unknown, TRet = unknown>(
      channel: string,
      handler: (args: TArgs, ctx: IpcContext) => Promise<TRet> | TRet,
    ): Disposable
  }
  lifecycle: {
    onBootBackground(handler: () => Promise<void> | void): Disposable
    onShutdown(handler: () => Promise<void> | void): Disposable
  }
  settings: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
  }
  storage: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
  }
  hermes: {
    callTool<TArgs = unknown, TRet = unknown>(
      tool: string,
      args: TArgs,
    ): Promise<TRet>
  }
}

export interface RendererHost {
  readonly id: string
  logger: Logger
  slots: {
    register<P = unknown>(
      slot: SlotName,
      component: ComponentType<P>,
      options?: { slotEntryId?: string; order?: number; props?: Partial<P> },
    ): Disposable
  }
  commands: {
    register(
      commandId: string,
      handler: (args?: unknown) => Promise<unknown> | unknown,
    ): Disposable
    invoke(commandId: string, args?: unknown): Promise<unknown>
  }
  settings: {
    define(schema: SettingsSchema): Disposable
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
    watch<T = unknown>(key: string, cb: (v: T) => void): Disposable
    /**
     * Declare a settings page contributed by this extension. The page renders
     * under the dedicated "Extensions" group in the host's Settings sidebar
     * (kept visually separate from the core panes).
     *
     * `labels` carries one entry per supported locale (`{ en, "zh-CN" }`) so
     * the host can pick the right text without owning the extension's
     * translation tables. `icon` is an optional lucide icon name.
     */
    registerPage(opts: {
      id: string
      labels: Record<string, string>
      icon?: string
      order?: number
      component: ComponentType<unknown>
    }): Disposable
  }
  storage: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
    watch<T = unknown>(key: string, cb: (v: T) => void): Disposable
  }
  ipc: {
    invoke<TArgs = unknown, TRet = unknown>(
      channel: string,
      args: TArgs,
    ): Promise<TRet>
  }
  /**
   * Host only tells the extension *which language* the app is in. The
   * extension owns its own translation tables and lookup logic — see the
   * `useI18n(host, catalogs)` helper from `@hermes-x/extension-host/renderer`.
   *
   * `language` is the current resolved code (`"en"` / `"zh-CN"`); the
   * subscribe channel re-fires whenever the user changes the app locale.
   */
  i18n: {
    readonly language: string
    subscribe(cb: (lang: string) => void): Disposable
  }
  hermes: {
    callTool(tool: string, args: unknown): Promise<unknown>
  }
  notify(kind: "info" | "warn" | "error", message: string): void
}

export type MainActivate = (host: MainHost) => Promise<void> | void
export type MainDeactivate = () => Promise<void> | void
export type RendererActivate = (host: RendererHost) => Promise<void> | void

export interface MainModule {
  activate: MainActivate
  deactivate?: MainDeactivate
}

export interface RendererModule {
  activate: RendererActivate
}

export type { ReactNode, ComponentType, SlotName, SlotEntry, SlotContext, SettingsSchema }
