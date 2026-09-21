/**
 * Per-session workspace binding with a product-level $HOME fallback.
 *
 * Each chat session can pin a different directory; the chat engine forwards
 * it as the structured cwd for each DSH turn and also adds a compact
 * user-turn context note so workspace switches stay explicit without
 * rebuilding the persisted system prompt. Sessions without a binding resolve
 * to the product workspace. Bindings are metadata only: file previews observe
 * individual resources on demand, never a whole project for every session.
 *
 * Persistence: `workspace.bindings` stores `Record<sessionId, path>`.
 * Restored at startup; orphaned bindings (target deleted / unreadable)
 * are dropped silently so the user isn't stuck with a permanently-broken
 * session.
 */
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import type { WorkspaceChange } from "@amiba/app-runtime/platform"

import { mainStore } from "./storage"
import { getDefaultWorkspaceRoot, ensureDefaultWorkspaceRoot } from "./workspace-root"

const STORE_KEY = "workspace.bindings"

interface Binding {
  path: string
}

/**
 * Validate a candidate bind target. Rejects:
 *   - empty / whitespace strings
 *   - paths that aren't an existing directory
 *   - the FS root or bare $HOME: explicit bindings must name a project
 */
async function validateBindTarget(target: string): Promise<string> {
  if (!target || !target.trim()) {
    throw new Error("workspace.bind: path required")
  }
  const abs = path.resolve(target)
  // Keep explicit project bindings scoped to a project directory.
  const parsed = path.parse(abs)
  if (abs === parsed.root) {
    throw new Error(`workspace.bind: refusing to bind filesystem root (${abs})`)
  }
  const home = os.homedir()
  if (abs === home) {
    throw new Error(
      `workspace.bind: refusing to bind home directory (${abs}). Pick a ` +
        "project subdirectory instead.",
    )
  }
  let stat: { isDirectory(): boolean }
  try {
    stat = await fs.stat(abs)
  } catch (err) {
    throw new Error(
      `workspace.bind: ${abs} does not exist or is unreadable (${(err as Error).message})`,
    )
  }
  if (!stat.isDirectory()) {
    throw new Error(`workspace.bind: ${abs} is not a directory`)
  }
  return abs
}

class WorkspaceManager extends EventEmitter {
  private bindings = new Map<string, Binding>()
  private loaded = false
  private mutations: Promise<unknown> = Promise.resolve()
  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(work)
    this.mutations = result.catch(() => {})
    return result
  }

  async init(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    // A failed storage read MUST NOT block app boot — if `get` rejects
    // we just skip restoration (the user can re-bind later) and let
    // the rest of `app.whenReady()` finish so a window actually opens.
    let stored: unknown
    try {
      const r = await mainStore.get(STORE_KEY)
      stored = r[STORE_KEY]
    } catch (err) {
      console.warn(
        "[workspace] could not read bindings from storage; skipping restore: %s",
        (err as Error)?.message,
      )
      return
    }
    if (!stored || typeof stored !== "object") return
    const map = stored as Record<string, unknown>
    const restored: Record<string, string> = {}
    for (const [sessionId, raw] of Object.entries(map)) {
      if (typeof raw !== "string" || !raw) continue
      try {
        const abs = await validateBindTarget(raw)
        this.bindings.set(sessionId, { path: abs })
        restored[sessionId] = abs
      } catch (err) {
        console.warn(
          "[workspace] dropping stale binding for session %s → %s: %s",
          sessionId,
          raw,
          (err as Error).message,
        )
      }
    }
    // Persist the pruned set so the next launch doesn't keep retrying
    // bindings we just rejected. Best-effort — a write failure here
    // shouldn't take the app down either.
    try {
      await mainStore.set({ [STORE_KEY]: restored })
    } catch (err) {
      console.warn(
        "[workspace] could not persist pruned bindings: %s",
        (err as Error)?.message,
      )
    }
  }

  getForSession(sessionId: string): string | null {
    return this.bindings.get(sessionId)?.path ?? getDefaultWorkspaceRoot()
  }

  /** Preserve Host's immutable cwd spelling when it names this same directory. */
  async resolveRuntimeCwd(sessionId: string, hostCwd: string): Promise<string> {
    const root = this.getForSession(sessionId)!
    const [local, host] = await Promise.all([fs.realpath(root), fs.realpath(hostCwd)])
    if (this.getForSession(sessionId) !== root) return this.resolveRuntimeCwd(sessionId, hostCwd)
    return local === host ? hostCwd : root
  }

  getDefaultRoot(): Promise<string> {
    return ensureDefaultWorkspaceRoot()
  }

  listBindings(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [sessionId, binding] of this.bindings) {
      out[sessionId] = binding.path
    }
    return out
  }

  /**
   * Resolve an existing path inside a session's bound workspace.
   *
   * Both the root and target go through `realpath`, so a lexical path that
   * looks contained but escapes through a symlink is rejected. Relative tool
   * paths are anchored to the workspace root; authoritative absolute paths
   * reported by DSH are accepted when they remain inside the same root.
   */
  async resolvePathForSession(
    sessionId: string,
    candidate: string,
  ): Promise<{ root: string; path: string; relativePath: string }> {
    const boundRoot = this.getForSession(sessionId)
    if (!boundRoot) {
      throw new Error("No workspace is bound to this conversation.")
    }
    const root = await fs.realpath(boundRoot)
    const requested = !candidate || candidate === "."
      ? root
      : path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(root, candidate)
    const resolved = await fs.realpath(requested)
    const relativePath = path.relative(root, resolved)
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(
        "The requested file is outside this conversation's workspace.",
      )
    }
    return {
      root,
      path: resolved,
      relativePath: relativePath.split(path.sep).join("/"),
    }
  }

  async resolveFileForSession(
    sessionId: string,
    candidate: string,
  ): Promise<{ root: string; path: string; relativePath: string }> {
    if (!candidate || !candidate.trim()) {
      throw new Error("A file path is required.")
    }
    return this.resolvePathForSession(sessionId, candidate)
  }

  bind(sessionId: string, target: string): Promise<void> {
    return this.mutate(() => this.bindNow(sessionId, target))
  }

  /** Restore a Host-created session without replacing a chosen local root. */
  bindIfUnbound(sessionId: string, target: string): Promise<string | null> {
    return this.mutate(async () => {
      if (!this.bindings.has(sessionId)) await this.bindNow(sessionId, target)
      return this.getForSession(sessionId)
    })
  }

  private async bindNow(sessionId: string, target: string): Promise<void> {
    if (!sessionId) throw new Error("workspace.bind: sessionId required")
    // The product workspace is implicit, not a manually bound project.
    if (path.resolve(target) === getDefaultWorkspaceRoot()) {
      if (!this.bindings.has(sessionId)) return
      await this.stopBinding(sessionId)
      await this.persist()
      this.emit("change", {
        kind: "unbound",
        sessionId,
      } satisfies WorkspaceChange)
      return
    }
    const abs = await validateBindTarget(target)
    const existing = this.bindings.get(sessionId)
    if (existing && existing.path === abs) return
    await this.stopBinding(sessionId)
    this.bindings.set(sessionId, { path: abs })
    await this.persist()
    this.emit("change", {
      kind: "bound",
      sessionId,
      path: abs,
    } satisfies WorkspaceChange)
  }

  unbind(sessionId: string): Promise<void> {
    return this.mutate(() => this.unbindNow(sessionId))
  }

  private async unbindNow(sessionId: string): Promise<void> {
    if (!sessionId) return
    if (!this.bindings.has(sessionId)) return
    await this.stopBinding(sessionId)
    await this.persist()
    this.emit("change", {
      kind: "unbound",
      sessionId,
    } satisfies WorkspaceChange)
  }

  /**
   * Subscribe to bind/unbind changes. File previews own their observations.
   */
  onChange(cb: (change: WorkspaceChange) => void): () => void {
    this.on("change", cb)
    return () => this.off("change", cb)
  }

  private async stopBinding(sessionId: string): Promise<void> {
    this.bindings.delete(sessionId)
  }

  private async persist(): Promise<void> {
    const map: Record<string, string> = {}
    for (const [sid, b] of this.bindings) map[sid] = b.path
    await mainStore.set({ [STORE_KEY]: map })
  }

  async dispose(): Promise<void> {
    for (const sid of Array.from(this.bindings.keys())) {
      await this.stopBinding(sid)
    }
  }
}

export const workspaceManager = new WorkspaceManager()

export async function startWorkspaceManager(): Promise<void> {
  await workspaceManager.init()
}

export async function stopWorkspaceManager(): Promise<void> {
  await workspaceManager.dispose()
}
