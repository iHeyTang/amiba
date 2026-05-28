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
}

declare global {
  interface Window {
    hermes: HermesBridgeApi
  }
}

export {}
