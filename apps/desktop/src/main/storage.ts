import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import { app } from "electron"

type StorageChange = { oldValue?: unknown; newValue?: unknown }
export type StorageChangeMap = Record<string, StorageChange>

const storeFile = () => path.join(app.getPath("userData"), "amiba-store.json")

/**
 * Cheap "do these two JSON-safe values have the same content" check.
 * Used by the store's diff() so unchanged-content rewrites don't fire
 * change events. Primitives, ``null``, and shape-stable plain
 * objects/arrays compose all of our payloads, so JSON.stringify is
 * deterministic and fast enough for the sizes we deal with (session
 * indices in the low hundreds).
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // ``undefined`` round-trips to absence-of-key — string-compare turns
  // both into "undefined" which is fine for our equality intent.
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

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
        // Empty file (zero bytes / whitespace-only) is treated as an
        // empty store rather than a parse error. This can happen if
        // the app was killed mid-write or the disk was full when we
        // tried to flush.
        if (!raw.trim()) {
          this.mem = {}
          return
        }
        try {
          this.mem = JSON.parse(raw)
        } catch (parseErr) {
          // Corrupted JSON. Don't take the whole app down — boot with
          // a fresh empty store but preserve the bad file under a
          // timestamped `.bak` so forensics can recover what's there.
          // The next `set()` writes a valid file and replaces the
          // bad one in place.
          const backup = `${storeFile()}.${Date.now()}.bak`
          try {
            await fs.rename(storeFile(), backup)
            console.warn(
              "[storage] amiba-store.json was corrupted; preserved as %s and starting fresh. Parse error: %s",
              backup,
              (parseErr as Error)?.message,
            )
          } catch {
            console.warn(
              "[storage] amiba-store.json was corrupted; could not back it up. Starting fresh. Parse error: %s",
              (parseErr as Error)?.message,
            )
          }
          this.mem = {}
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this.mem = {}
        } else {
          // Read-side I/O error (permission, disk failure). Same
          // recovery: boot empty rather than wedge the entire app.
          // We don't back up the file here — we couldn't even read it.
          console.warn(
            "[storage] amiba-store.json read failed; starting empty. Error: %s",
            (err as Error)?.message,
          )
          this.mem = {}
        }
      }
    })()
    try {
      await this.loading
    } finally {
      this.loading = null
    }
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
      // Fast-path: same reference (no change).
      if (prev[k] === next[k]) continue
      // Reference-only comparison would flag every IPC-deserialised
      // payload as "changed" because the writer's array/object gets a
      // fresh reference each time it crosses the bridge. That makes
      // the renderer's persist-effect → storage-change-listener →
      // setState path self-sustaining: a single ``setSessions`` rebroadcasts
      // forever, with each cycle costing an IPC round-trip and a React
      // re-render. Detect content equality via JSON.stringify so
      // identical-content writes don't emit.
      if (jsonEqual(prev[k], next[k])) continue
      changes[k] = { oldValue: prev[k], newValue: next[k] }
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
