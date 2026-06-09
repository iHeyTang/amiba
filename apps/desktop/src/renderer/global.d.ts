/**
 * Global ambient declarations for the renderer process. Re-declares the
 * Electron-bridged `window.hermes` shape WITHOUT importing from the preload
 * source — the preload module's `import { contextBridge } from "electron"`
 * leaks into the renderer's typecheck classpath otherwise.
 */

import type {
  ClientToEngineMessage,
  EngineToClientMessage
} from "@hermes-x/core"

type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageChangeMap = Record<string, StorageChange>

type WorkspaceChange =
  | { kind: "bound"; sessionId: string; path: string }
  | { kind: "unbound"; sessionId: string }

interface HermesJobLogMsg {
  jobId: string
  stream: "stdout" | "stderr"
  line: string
}
interface HermesJobEndMsg {
  jobId: string
  exitCode: number | null
  error?: string
}
interface HermesPtyDataMsg {
  jobId: string
  data: string
}
interface HermesDetectionResult {
  installed: boolean
  binary?: string
  version?: string
}

interface HermesBridgeApi {
  storage: {
    get(keys?: string | string[]): Promise<Record<string, unknown>>
    set(patch: Record<string, unknown>): Promise<void>
    remove(keys: string | string[]): Promise<void>
    onChanged(cb: (changes: StorageChangeMap) => void): () => void
  }
  chat: {
    send(msg: ClientToEngineMessage): Promise<void>
    onMessage(cb: (msg: EngineToClientMessage) => void): () => void
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  workspaces: {
    bind(sessionId: string, path: string): Promise<void>
    unbind(sessionId: string): Promise<void>
    getCurrent(sessionId: string): Promise<string | null>
    onChanged(cb: (change: WorkspaceChange) => void): () => void
    getPathForFile(file: File): string
  }
  files: {
    list(sessionId: string, query: string): Promise<{ path: string; isDir: boolean }[]>
  }
  notifier: {
    onMessage(cb: (msg: unknown) => void): () => void
    activateMain(): Promise<void>
    approve(approvalId: string): Promise<void>
    deny(approvalId: string): Promise<void>
    demo(kind?: "cron-completed" | "approval-pending"): Promise<void>
  }
  quickAsk: {
    onPrefill(
      cb: (payload: { text: string; sourceApp: string }) => void,
    ): () => void
    dismiss(): Promise<void>
    resize(contentHeightPx: number): Promise<void>
  }
  hermesRuntime: {
    detect(): Promise<HermesDetectionResult>
    install(): Promise<{ id: string; pid: number | undefined }>
    installPty(): Promise<{ id: string; pid: number }>
    installPlugin(args: {
      binary: string
      pluginId: string
    }): Promise<{ id: string; pid: number | undefined }>
    installBackplane(args: { binary: string }): Promise<{ id: string; pid: number | undefined }>
    startBackplane(args: {
      binary: string
    }): Promise<{ id: string; pid: number | undefined; alreadyRunning: boolean }>
    stopBackplane(): Promise<boolean>
    cancelJob(jobId: string): Promise<boolean>
    ptyInput(args: { jobId: string; data: string }): Promise<boolean>
    ptyResize(args: { jobId: string; cols: number; rows: number }): Promise<boolean>
    requiredPlugins(): Promise<readonly string[]>
    installedPlugins(): Promise<readonly string[]>
    installDisplayCommand(): Promise<string>
    onJobLog(cb: (msg: HermesJobLogMsg) => void): () => void
    onJobEnd(cb: (msg: HermesJobEndMsg) => void): () => void
    onPtyData(cb: (msg: HermesPtyDataMsg) => void): () => void
  }
  extensions: {
    listManifests(): Promise<Array<{ manifest: import("@hermes-x/extension-api").ExtensionManifest; path: string }>>
    invoke(extensionId: string, channel: string, args: unknown): Promise<unknown>
    i18nResources(
      extensionId: string,
      locale: "en" | "zh-CN",
    ): Promise<Record<string, string>>
    status(): Promise<Array<{ id: string; status: string; error?: string; source?: string }>>
    pickFolder(): Promise<string | null>
    addLocal(path: string): Promise<{ ok: boolean; id?: string; error?: string }>
    reload(id: string): Promise<{ ok: boolean; error?: string }>
    uninstall(id: string): Promise<{ ok: boolean; error?: string }>
    marketplace: {
      getIndexUrl(): Promise<string>
      list(): Promise<
        | { ok: true; entries: import("@hermes-x/extension-host/preload").MarketplaceEntry[] }
        | { ok: false; error: string }
      >
      install(
        entry: import("@hermes-x/extension-host/preload").MarketplaceEntry,
      ): Promise<
        | { ok: true; id: string; version: string }
        | { ok: false; error: string }
      >
    }
    onExtensionsChanged(cb: (extensionId: string | null) => void): () => void
    /**
     * Base URL of the local extension HTTP server (e.g. `http://127.0.0.1:54321`).
     * Cached module-level after the first call.
     */
    getHttpBaseUrl(): Promise<string>
  }
  /** Returns the absolute file:// path of the webview bridge preload bundle. */
  getWebviewPreloadPath(): Promise<string>
  /** Returns the current { language, theme } init state for a webview. */
  getWebviewInitState(): Promise<{ language: string; theme: string }>
  /**
   * Push the renderer's resolved language to main for rebroadcast to all
   * extension webviews. Only the renderer can resolve the "auto"
   * preference against `navigator.language`, so it is the source of truth.
   */
  setResolvedLanguage(language: "en" | "zh-CN"): Promise<void>
  /**
   * Push the renderer's resolved theme to main, which rebroadcasts it to
   * every extension webview. Only the renderer can resolve the "auto"
   * preference against `prefers-color-scheme`, so it is the source of truth.
   */
  setResolvedTheme(theme: "light" | "dark"): Promise<void>
  /**
   * Subscribe to `chat.startSession` requests forwarded from an
   * extension webview via the host bridge. Payload carries the
   * prompt text the extension wants the assistant to act on.
   * Returns an unsubscribe.
   */
  onChatStartSession(cb: (payload: { text: string }) => void): () => void
}

declare global {
  interface Window {
    hermes: HermesBridgeApi
  }
}

export {}
