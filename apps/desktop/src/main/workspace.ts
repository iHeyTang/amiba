import { EventEmitter } from "node:events"
import path from "node:path"
import chokidar from "chokidar"
import type { WorkspaceChange } from "@hermes-x/platform"

import { mainStore } from "./storage"

const STORE_KEY = "workspace.boundPath"

class WorkspaceManager extends EventEmitter {
  private current: string | null = null
  private watcher: chokidar.FSWatcher | null = null
  private loaded = false

  async init(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const r = await mainStore.get(STORE_KEY)
    const stored = r[STORE_KEY]
    if (typeof stored === "string" && stored.length > 0) {
      try {
        await this.startWatcher(stored)
        this.current = stored
      } catch (err) {
        console.warn("[workspace] failed to restore binding %s: %o", stored, err)
        await mainStore.remove(STORE_KEY)
      }
    }
  }

  getCurrent(): string | null {
    return this.current
  }

  async bind(target: string): Promise<void> {
    if (!target) throw new Error("workspace.bind: path required")
    const abs = path.resolve(target)
    if (this.current === abs) return
    await this.stopWatcher()
    await this.startWatcher(abs)
    this.current = abs
    await mainStore.set({ [STORE_KEY]: abs })
    this.emit("change", { kind: "bound", path: abs } satisfies WorkspaceChange)
  }

  async unbind(): Promise<void> {
    if (!this.current) return
    await this.stopWatcher()
    this.current = null
    await mainStore.remove(STORE_KEY)
    this.emit("change", { kind: "unbound" } satisfies WorkspaceChange)
  }

  onChange(cb: (change: WorkspaceChange) => void): () => void {
    this.on("change", cb)
    return () => this.off("change", cb)
  }

  private async startWatcher(target: string): Promise<void> {
    const w = chokidar.watch(target, {
      ignored: (p: string) => /(^|[\\/])\.(git|hg|svn|DS_Store)([\\/]|$)/.test(p),
      ignoreInitial: true,
      persistent: true,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    })
    const fire = (event: "add" | "change" | "unlink") => (p: string) => {
      this.emit("change", { kind: "file", event, path: p } satisfies WorkspaceChange)
    }
    w.on("add", fire("add"))
    w.on("change", fire("change"))
    w.on("unlink", fire("unlink"))
    w.on("error", (err: unknown) => {
      console.warn("[workspace] watcher error:", err)
    })
    this.watcher = w
  }

  private async stopWatcher(): Promise<void> {
    const w = this.watcher
    this.watcher = null
    if (w) await w.close()
  }

  async dispose(): Promise<void> {
    await this.stopWatcher()
  }
}

export const workspaceManager = new WorkspaceManager()

export async function startWorkspaceManager(): Promise<void> {
  await workspaceManager.init()
}

export async function stopWorkspaceManager(): Promise<void> {
  await workspaceManager.dispose()
}
