/**
 * Per-session workspace binding with a product-level $HOME fallback.
 *
 * Each chat session can pin a different directory; the chat engine forwards
 * it as the structured cwd for each DSH turn and also adds a compact
 * user-turn context note so workspace switches stay explicit without
 * rebuilding the persisted system prompt. Sessions without a binding resolve
 * to the user's home directory. The default root is never watched recursively;
 * a chokidar watcher runs only for explicit project-directory bindings so the
 * app does not crawl the user's entire home directory.
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
import chokidar from "chokidar"
import type { WorkspaceChange } from "@amiba/app-runtime/platform"

import { mainStore } from "./storage"
import { getDefaultWorkspaceRoot } from "./workspace-root"

const STORE_KEY = "workspace.bindings"

/**
 * Directories chokidar must NEVER descend into when watching a
 * developer-style workspace. These trees can each contain hundreds of
 * thousands of files and would saturate the IPC channel (and the
 * watcher's event loop) within seconds of binding a typical Node /
 * Rust / Python repo. The patterns match anywhere along the path.
 */
const IGNORED_PATTERNS = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])\.hg([\\/]|$)/,
  /(^|[\\/])\.svn([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])build([\\/]|$)/,
  /(^|[\\/])out([\\/]|$)/,
  /(^|[\\/])target([\\/]|$)/,
  /(^|[\\/])\.next([\\/]|$)/,
  /(^|[\\/])\.nuxt([\\/]|$)/,
  /(^|[\\/])\.turbo([\\/]|$)/,
  /(^|[\\/])\.cache([\\/]|$)/,
  /(^|[\\/])coverage([\\/]|$)/,
  /(^|[\\/])\.venv([\\/]|$)/,
  /(^|[\\/])__pycache__([\\/]|$)/,
]

function isIgnored(p: string): boolean {
  return IGNORED_PATTERNS.some((re) => re.test(p))
}

interface Binding {
  path: string
  watcher: chokidar.FSWatcher | null
}

/**
 * Validate a candidate bind target. Rejects:
 *   - empty / whitespace strings
 *   - paths that aren't an existing directory
 *   - paths that are the FS root (`/`, `C:\`) — chokidar would try to
 *     walk the whole disk
 *   - the user's bare $HOME — same risk + likely a misclick
 */
async function validateBindTarget(target: string): Promise<string> {
  if (!target || !target.trim()) {
    throw new Error("workspace.bind: path required")
  }
  const abs = path.resolve(target)
  // Reject the FS root and bare home — both produce catastrophic watcher
  // load and are almost certainly mistakes.
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
        const watcher = startWatcher(abs, (event, p) =>
          this.emitFile(sessionId, event, p),
        )
        this.bindings.set(sessionId, { path: abs, watcher })
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

  getDefaultRoot(): string {
    return getDefaultWorkspaceRoot()
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
    // $HOME is the implicit default, not a persisted exceptional binding.
    // Treat selecting it as "use the default" and, importantly, do not attach
    // a recursive chokidar watcher to the whole home directory.
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
    const watcher = startWatcher(abs, (event, p) =>
      this.emitFile(sessionId, event, p),
    )
    this.bindings.set(sessionId, { path: abs, watcher })
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
   * Subscribe to bind/unbind changes. File-change events stay in-process
   * — see module header for rationale.
   */
  onChange(cb: (change: WorkspaceChange) => void): () => void {
    this.on("change", cb)
    return () => this.off("change", cb)
  }

  /**
   * Internal file-event channel for in-main consumers (e.g. an eventual
   * fs-scoped plugin). NOT exposed to renderers. Listener should be
   * cheap — events fire once per add/change/unlink under the bound tree.
   */
  onFile(
    cb: (e: {
      sessionId: string
      event: "add" | "change" | "unlink"
      path: string
    }) => void,
  ): () => void {
    this.on("file", cb)
    return () => this.off("file", cb)
  }

  private emitFile(
    sessionId: string,
    event: "add" | "change" | "unlink",
    p: string,
  ): void {
    this.emit("file", { sessionId, event, path: p })
  }

  private async stopBinding(sessionId: string): Promise<void> {
    const b = this.bindings.get(sessionId)
    this.bindings.delete(sessionId)
    if (b?.watcher) await b.watcher.close()
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

function startWatcher(
  target: string,
  onFile: (event: "add" | "change" | "unlink", path: string) => void,
): chokidar.FSWatcher {
  const w = chokidar.watch(target, {
    ignored: (p: string) => isIgnored(p),
    ignoreInitial: true,
    persistent: true,
    depth: 8,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })
  w.on("add", (p: string) => onFile("add", p))
  w.on("change", (p: string) => onFile("change", p))
  w.on("unlink", (p: string) => onFile("unlink", p))
  w.on("error", (err: unknown) => {
    console.warn("[workspace] watcher error:", err)
  })
  return w
}

export const workspaceManager = new WorkspaceManager()

export async function startWorkspaceManager(): Promise<void> {
  await workspaceManager.init()
}

export async function stopWorkspaceManager(): Promise<void> {
  await workspaceManager.dispose()
}
