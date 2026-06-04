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

export type MainActivate = (host: MainHost) => Promise<void> | void
export type MainDeactivate = () => Promise<void> | void

export interface MainModule {
  activate: MainActivate
  deactivate?: MainDeactivate
}

export type { SettingsSchema }
