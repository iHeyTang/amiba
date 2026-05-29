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
  notifier: {
    onMessage(cb: (msg: unknown) => void): () => void
    activateMain(): Promise<void>
    approve(approvalId: string): Promise<void>
    deny(approvalId: string): Promise<void>
  }
  hermesRuntime: {
    detect(): Promise<HermesDetectionResult>
    install(): Promise<{ id: string; pid: number | undefined }>
    installPty(): Promise<{ id: string; pid: number }>
    installPlugin(args: {
      binary: string
      pluginId: string
    }): Promise<{ id: string; pid: number | undefined }>
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
}

declare global {
  interface Window {
    hermes: HermesBridgeApi
  }
}

export {}
