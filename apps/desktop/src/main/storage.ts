import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import { app } from "electron"

type StorageChange = { oldValue?: unknown; newValue?: unknown }
export type StorageChangeMap = Record<string, StorageChange>

const storeFile = () => path.join(app.getPath("userData"), "hermes-store.json")

class Store extends EventEmitter {
  private mem: Record<string, unknown> | null = null
  private loading: Promise<void> | null = null

  private async load(): Promise<Record<string, unknown>> {
    if (this.mem) return this.mem
    if (this.loading) {
      await this.loading
      return this.mem ?? {}
    }
    this.loading = (async () => {
      try {
        const raw = await fs.readFile(storeFile(), "utf8")
        this.mem = JSON.parse(raw)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this.mem = {}
        } else {
          throw err
        }
      }
    })()
    await this.loading
    this.loading = null
    return this.mem ?? {}
  }

  private async persist(): Promise<void> {
    if (!this.mem) return
    await fs.mkdir(path.dirname(storeFile()), { recursive: true })
    await fs.writeFile(storeFile(), JSON.stringify(this.mem, null, 2), "utf8")
  }

  private diff(prev: Record<string, unknown>, next: Record<string, unknown>): StorageChangeMap {
    const changes: StorageChangeMap = {}
    for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (prev[k] !== next[k]) changes[k] = { oldValue: prev[k], newValue: next[k] }
    }
    return changes
  }

  async get(keys?: string | string[]): Promise<Record<string, unknown>> {
    const all = await this.load()
    if (!keys) return { ...all }
    const list = Array.isArray(keys) ? keys : [keys]
    return Object.fromEntries(list.map((k) => [k, all[k]]))
  }

  async set(patch: Record<string, unknown>): Promise<void> {
    const prev = await this.load()
    const snap = { ...prev }
    Object.assign(this.mem!, patch)
    await this.persist()
    const changes = this.diff(snap, this.mem!)
    if (Object.keys(changes).length > 0) this.emit("changed", changes)
  }

  async remove(keys: string | string[]): Promise<void> {
    const prev = await this.load()
    const snap = { ...prev }
    const list = Array.isArray(keys) ? keys : [keys]
    for (const k of list) delete this.mem![k]
    await this.persist()
    const changes = this.diff(snap, this.mem!)
    if (Object.keys(changes).length > 0) this.emit("changed", changes)
  }

  /** Subscribe to all changes. Returns unsubscribe. */
  watch(listener: (changes: StorageChangeMap) => void): () => void {
    this.on("changed", listener)
    return () => this.off("changed", listener)
  }
}

/**
 * Singleton store used by both the main-process PlatformAdapter (so
 * HermesClient + backplaneFetch can read `settings.backplane.key`) and the
 * IPC handlers that serve the renderer's adapter. Sharing the instance means
 * renderer writes and main-side reads see the same state without race
 * conditions across two `fs.readFile` paths.
 */
export const mainStore = new Store()
