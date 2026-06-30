/**
 * packages/extension-host/src/main/runner-controller.ts
 *
 * Desktop main-process side of the Phase-D isolation model.
 * Creates and manages one utilityProcess per extension.
 *
 * Each runner process:
 *   - is forked from out/extension-runner/index.js (the runner bundle)
 *   - receives { kind: "activate" } after setup
 *   - sends back { kind: "activated", ok: true/false }
 *   - handles inbound ipc.invoke requests forwarded from the renderer
 *   - is killed (or gracefully shut down) on deactivate/reload
 */

import { utilityProcess, type UtilityProcess } from "electron"

// ── Types ────────────────────────────────────────────────────────────────────

export interface RunnerHandle {
  extensionId: string
  proc: UtilityProcess
  /** Channels this runner has registered via host.ipc.expose. */
  exposedChannels: Set<string>
}

export interface RunnerManagerOpts {
  /** Absolute path to the runner bundle (out/extension-runner/index.js). */
  runnerPath: string
  /** Bridge for settings.* */
  settingsStore: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  /** Bridge for storage.* — per-extension FS storage */
  storage: {
    get<T>(extensionId: string, key: string, fallback: T): Promise<T>
    set(extensionId: string, key: string, value: unknown): Promise<void>
  }
  /** Hermes-agent tool dispatcher */
  callTool: (tool: string, args: unknown) => Promise<unknown>
  /**
   * Read-only fetch of a hermes-agent session's stats — backs
   * host.hermes.getSession. Optional so older bootstrap paths
   * (unit tests, etc.) can leave it unwired; the runner returns
   * null in that case.
   */
  getSession?: (sessionId: string) => Promise<unknown | null>
  /**
   * Bulk session list — backs host.hermes.listSessions. Optional;
   * runner returns [] when unwired.
   */
  listSessions?: (opts?: {
    limit?: number
    offset?: number
    source?: string
  }) => Promise<unknown[]>
  /**
   * Authenticated backplane fetch — backs host.hermes.backplaneFetch.
   * Optional; runner throws "not wired" when absent. Desktop main wires
   * this to @amiba/core's backplaneFetch, returning a serializable
   * { ok, status, body } envelope (the raw Response can't cross RPC).
   */
  backplaneFetch?: (
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<{ ok: boolean; status: number; body: string }>
  /** Activation timeout in ms (default 10_000) */
  activateTimeoutMs?: number
  /** Graceful shutdown timeout in ms before SIGKILL (default 5_000) */
  shutdownTimeoutMs?: number
  /** ipc.invoke timeout in ms (default 30_000) */
  invokeTimeoutMs?: number
}

// ── Message shapes (runner ↔ controller) ────────────────────────────────────

interface RunnerReadyMsg { kind: "runner.ready" }
interface ActivatedMsg { kind: "activated"; ok: boolean; error?: string }
interface IpcExposedMsg { kind: "ipc.exposed"; channel: string }
interface IpcUnexposedMsg { kind: "ipc.unexposed"; channel: string }
interface IpcResponseMsg { kind: "ipc.response"; id: string; result?: unknown; error?: string }
interface RpcRequestMsg { kind: "rpc.request"; id: string; method: string; args: unknown }
interface LogMsg { kind: "log"; level: "debug" | "info" | "warn" | "error"; args: unknown[] }

type RunnerMessage =
  | RunnerReadyMsg
  | ActivatedMsg
  | IpcExposedMsg
  | IpcUnexposedMsg
  | IpcResponseMsg
  | RpcRequestMsg
  | LogMsg

// ── Helpers ──────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createRunnerManager(opts: RunnerManagerOpts) {
  const ACTIVATE_TIMEOUT = opts.activateTimeoutMs ?? 10_000
  const SHUTDOWN_TIMEOUT = opts.shutdownTimeoutMs ?? 5_000
  const INVOKE_TIMEOUT = opts.invokeTimeoutMs ?? 30_000

  const runners = new Map<string, RunnerHandle>()

  /**
   * Fork a fresh utilityProcess for an extension, wire its IPC bridge,
   * and wait for { kind: "activated" }.
   */
  async function activateExtension(
    extensionId: string,
    mainPath: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    // Kill any existing runner for this id first (reload scenario).
    if (runners.has(extensionId)) {
      await deactivateExtension(extensionId)
    }

    const proc = utilityProcess.fork(
      opts.runnerPath,
      [extensionId, mainPath],
      { stdio: "inherit" },
    )

    const handle: RunnerHandle = {
      extensionId,
      proc,
      exposedChannels: new Set(),
    }
    runners.set(extensionId, handle)

    // Per-invocation RPC pending map (invoke round-trips from renderer)
    let invokeCounter = 0
    const pendingInvokes = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

    // Message handler — wired before we send "activate" so we never miss a message.
    let activationResolve: ((r: { ok: true } | { ok: false; error: string }) => void) | undefined
    let activationReject: ((e: Error) => void) | undefined

    proc.on("message", (raw: unknown) => {
      const msg = raw as RunnerMessage
      switch (msg.kind) {
        case "runner.ready":
          // Runner is ready — send activate.
          proc.postMessage({ kind: "activate" })
          break

        case "activated":
          if (activationResolve) {
            if (msg.ok) {
              activationResolve({ ok: true })
            } else {
              activationResolve({ ok: false, error: msg.error ?? "activate returned ok:false" })
            }
            activationResolve = undefined
            activationReject = undefined
          }
          break

        case "ipc.exposed":
          handle.exposedChannels.add(msg.channel)
          break

        case "ipc.unexposed":
          handle.exposedChannels.delete(msg.channel)
          break

        case "ipc.response": {
          const pending = pendingInvokes.get(msg.id)
          if (!pending) break
          pendingInvokes.delete(msg.id)
          if (msg.error !== undefined) {
            pending.reject(new Error(msg.error))
          } else {
            pending.resolve(msg.result)
          }
          break
        }

        case "rpc.request":
          void handleRpcRequest(extensionId, proc, msg)
          break

        case "log": {
          const fn = (console[msg.level] ?? console.log) as (...a: unknown[]) => void
          fn(...msg.args)
          break
        }

        default:
          console.warn(`[runner-controller] unknown message from ${extensionId}:`, (msg as { kind: string }).kind)
      }
    })

    // If the process exits unexpectedly before activation finishes, reject.
    const earlyExitHandler = (code: number | null) => {
      if (activationReject) {
        activationReject(new Error(`runner process exited with code ${code} before activation`))
        activationResolve = undefined
        activationReject = undefined
      }
      // Reject any pending invokes.
      for (const [, p] of pendingInvokes) {
        p.reject(new Error(`runner process exited unexpectedly (code ${code})`))
      }
      pendingInvokes.clear()
      runners.delete(extensionId)
    }
    proc.once("exit", earlyExitHandler)

    // Store invoke sender so invokeExtensionChannel can use it.
    // We attach it as a closure captured variable accessed via the handle.
    // To expose it cleanly, we augment the handle with an internal map ref.
    ;(handle as RunnerHandleInternal).__pendingInvokes = pendingInvokes
    ;(handle as RunnerHandleInternal).__invokeCounter = () => ++invokeCounter

    try {
      const result = await withTimeout(
        new Promise<{ ok: true } | { ok: false; error: string }>((res, rej) => {
          activationResolve = res
          activationReject = rej
        }),
        ACTIVATE_TIMEOUT,
        `activate(${extensionId})`,
      )

      // Remove the early-exit guard now that activation settled.
      proc.off("exit", earlyExitHandler)

      if (!result.ok) {
        runners.delete(extensionId)
      }

      return result
    } catch (e) {
      proc.off("exit", earlyExitHandler)
      runners.delete(extensionId)
      try { proc.kill() } catch { /* ignore */ }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Gracefully shut down the runner for an extension. Sends { kind: "shutdown" },
   * waits for exit, kills if it takes too long.
   */
  async function deactivateExtension(extensionId: string): Promise<void> {
    const handle = runners.get(extensionId)
    if (!handle) return
    runners.delete(extensionId)

    const { proc } = handle

    await withTimeout(
      new Promise<void>((resolve) => {
        proc.once("exit", () => resolve())
        proc.postMessage({ kind: "shutdown" })
      }),
      SHUTDOWN_TIMEOUT,
      `shutdown(${extensionId})`,
    ).catch(() => {
      // Timeout — force kill.
      try { proc.kill() } catch { /* ignore */ }
    })
  }

  /**
   * Forward a renderer ipc.invoke call to the appropriate runner.
   */
  function invokeExtensionChannel(
    extensionId: string,
    channel: string,
    args: unknown,
  ): Promise<unknown> {
    const handle = runners.get(extensionId)
    if (!handle) {
      return Promise.reject(new Error(`no runner for extension: ${extensionId}`))
    }
    if (!handle.exposedChannels.has(channel)) {
      return Promise.reject(new Error(`extension ${extensionId} has not exposed channel: ${channel}`))
    }

    const internal = handle as RunnerHandleInternal
    const id = `inv-${internal.__invokeCounter()}`
    const pendingInvokes = internal.__pendingInvokes

    return withTimeout(
      new Promise<unknown>((resolve, reject) => {
        pendingInvokes.set(id, { resolve, reject })
        handle.proc.postMessage({ kind: "ipc.invoke", id, channel, args })
      }),
      INVOKE_TIMEOUT,
      `invoke(${extensionId}/${channel})`,
    )
  }

  function getRunners(): RunnerHandle[] {
    return [...runners.values()]
  }

  /**
   * Push a chat-engine event out to every live runner. Best-effort:
   * a failed postMessage on one runner (process exited mid-broadcast,
   * IPC pipe wedged) won't block the others. The runner side filters
   * by event name — broadcasting to all is cheaper than maintaining
   * a per-event subscriber registry on the main side.
   */
  function broadcastChatEvent(event: string, payload: unknown): void {
    for (const handle of runners.values()) {
      try {
        handle.proc.postMessage({ kind: "chat.event", event, payload })
      } catch {
        // Runner pipe wedged or process gone; let the next call reap.
      }
    }
  }

  return {
    activateExtension,
    deactivateExtension,
    invokeExtensionChannel,
    getRunners,
    broadcastChatEvent,
  }
}

// ── Internal augmented handle type ───────────────────────────────────────────

interface RunnerHandleInternal extends RunnerHandle {
  __pendingInvokes: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  __invokeCounter: () => number
}

// ── RPC bridge (runner → controller → main-side services) ───────────────────

async function handleRpcRequest(
  extensionId: string,
  proc: UtilityProcess,
  msg: RpcRequestMsg,
): Promise<void> {
  // This function is called from within the activateExtension closure but
  // needs access to opts. We capture it via module-level closure trick:
  // the factory returns closures that capture opts, but handleRpcRequest is
  // defined outside. We use a module-level registry of per-process handlers.
  const handler = rpcHandlerRegistry.get(proc)
  if (!handler) {
    proc.postMessage({ kind: "rpc.response", id: msg.id, error: "no RPC handler registered" })
    return
  }
  try {
    const result = await handler(extensionId, msg.method, msg.args)
    proc.postMessage({ kind: "rpc.response", id: msg.id, result })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    proc.postMessage({ kind: "rpc.response", id: msg.id, error })
  }
}

/**
 * Module-level registry mapping each UtilityProcess instance to its RPC handler.
 * This allows handleRpcRequest (module-level) to access the opts for each runner.
 */
const rpcHandlerRegistry = new Map<
  UtilityProcess,
  (extensionId: string, method: string, args: unknown) => Promise<unknown>
>()

/**
 * Extended factory that wires RPC bridge. We need to re-export a version
 * that registers the RPC handler. Override createRunnerManager to include this.
 */
export function createRunnerManagerWithRpc(opts: RunnerManagerOpts) {
  const ACTIVATE_TIMEOUT = opts.activateTimeoutMs ?? 10_000
  const SHUTDOWN_TIMEOUT = opts.shutdownTimeoutMs ?? 5_000
  const INVOKE_TIMEOUT = opts.invokeTimeoutMs ?? 30_000

  const runners = new Map<string, RunnerHandle>()

  async function activateExtension(
    extensionId: string,
    mainPath: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (runners.has(extensionId)) {
      await deactivateExtension(extensionId)
    }

    const proc = utilityProcess.fork(
      opts.runnerPath,
      [extensionId, mainPath],
      { stdio: "inherit" },
    )

    // Register RPC handler for this process.
    rpcHandlerRegistry.set(proc, async (extId, method, args) => {
      const a = args as Record<string, unknown>
      switch (method) {
        case "settings.get":
          return opts.settingsStore.get(
            `ext.${extId}.${a.key as string}`,
            a.fallback as never,
          )
        case "settings.set":
          return opts.settingsStore.set(`ext.${extId}.${a.key as string}`, a.value)
        case "storage.get":
          return opts.storage.get(extId, a.key as string, a.fallback as never)
        case "storage.set":
          return opts.storage.set(extId, a.key as string, a.value)
        case "hermes.callTool":
          return opts.callTool(a.tool as string, a.args)
        case "hermes.getSession":
          // Optional bootstrap hook — older callers may not wire this.
          if (!opts.getSession) return null
          return opts.getSession(a.sessionId as string)
        case "hermes.listSessions":
          if (!opts.listSessions) return []
          return opts.listSessions(a.opts as Record<string, unknown> | undefined)
        case "hermes.backplaneFetch":
          if (!opts.backplaneFetch) {
            throw new Error("hermes.backplaneFetch not wired")
          }
          return opts.backplaneFetch(
            a.path as string,
            a.init as
              | { method?: string; headers?: Record<string, string>; body?: string }
              | undefined,
          )
        default:
          throw new Error(`unknown RPC method: ${method}`)
      }
    })

    const handle: RunnerHandle = {
      extensionId,
      proc,
      exposedChannels: new Set(),
    }
    runners.set(extensionId, handle)

    let invokeCounter = 0
    const pendingInvokes = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    ;(handle as RunnerHandleInternal).__pendingInvokes = pendingInvokes
    ;(handle as RunnerHandleInternal).__invokeCounter = () => ++invokeCounter

    let activationResolve: ((r: { ok: true } | { ok: false; error: string }) => void) | undefined
    let activationReject: ((e: Error) => void) | undefined

    proc.on("message", (raw: unknown) => {
      const msg = raw as RunnerMessage
      switch (msg.kind) {
        case "runner.ready":
          proc.postMessage({ kind: "activate" })
          break

        case "activated":
          if (activationResolve) {
            if (msg.ok) {
              activationResolve({ ok: true })
            } else {
              activationResolve({ ok: false, error: msg.error ?? "activate returned ok:false" })
            }
            activationResolve = undefined
            activationReject = undefined
          }
          break

        case "ipc.exposed":
          handle.exposedChannels.add(msg.channel)
          break

        case "ipc.unexposed":
          handle.exposedChannels.delete(msg.channel)
          break

        case "ipc.response": {
          const pending = pendingInvokes.get(msg.id)
          if (!pending) break
          pendingInvokes.delete(msg.id)
          if (msg.error !== undefined) {
            pending.reject(new Error(msg.error))
          } else {
            pending.resolve(msg.result)
          }
          break
        }

        case "rpc.request":
          void handleRpcRequest(extensionId, proc, msg)
          break

        case "log": {
          const fn = (console[msg.level] ?? console.log) as (...a: unknown[]) => void
          fn(...msg.args)
          break
        }

        default:
          console.warn(`[runner-controller] unknown message from ${extensionId}:`, (msg as { kind: string }).kind)
      }
    })

    const earlyExitHandler = (code: number | null) => {
      rpcHandlerRegistry.delete(proc)
      if (activationReject) {
        activationReject(new Error(`runner process exited with code ${code} before activation`))
        activationResolve = undefined
        activationReject = undefined
      }
      for (const [, p] of pendingInvokes) {
        p.reject(new Error(`runner process exited unexpectedly (code ${code})`))
      }
      pendingInvokes.clear()
      runners.delete(extensionId)
    }
    proc.once("exit", earlyExitHandler)

    try {
      const result = await withTimeout(
        new Promise<{ ok: true } | { ok: false; error: string }>((res, rej) => {
          activationResolve = res
          activationReject = rej
        }),
        ACTIVATE_TIMEOUT,
        `activate(${extensionId})`,
      )

      proc.off("exit", earlyExitHandler)

      if (!result.ok) {
        rpcHandlerRegistry.delete(proc)
        runners.delete(extensionId)
      }

      return result
    } catch (e) {
      proc.off("exit", earlyExitHandler)
      rpcHandlerRegistry.delete(proc)
      runners.delete(extensionId)
      try { proc.kill() } catch { /* ignore */ }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async function deactivateExtension(extensionId: string): Promise<void> {
    const handle = runners.get(extensionId)
    if (!handle) return
    runners.delete(extensionId)

    const { proc } = handle
    rpcHandlerRegistry.delete(proc)

    await withTimeout(
      new Promise<void>((resolve) => {
        proc.once("exit", () => resolve())
        proc.postMessage({ kind: "shutdown" })
      }),
      SHUTDOWN_TIMEOUT,
      `shutdown(${extensionId})`,
    ).catch(() => {
      try { proc.kill() } catch { /* ignore */ }
    })
  }

  function invokeExtensionChannel(
    extensionId: string,
    channel: string,
    args: unknown,
  ): Promise<unknown> {
    const handle = runners.get(extensionId)
    if (!handle) {
      return Promise.reject(new Error(`no runner for extension: ${extensionId}`))
    }
    if (!handle.exposedChannels.has(channel)) {
      return Promise.reject(new Error(`extension ${extensionId} has not exposed channel: ${channel}`))
    }

    const internal = handle as RunnerHandleInternal
    const id = `inv-${internal.__invokeCounter()}`
    const pendingInvokes = internal.__pendingInvokes

    return withTimeout(
      new Promise<unknown>((resolve, reject) => {
        pendingInvokes.set(id, { resolve, reject })
        handle.proc.postMessage({ kind: "ipc.invoke", id, channel, args })
      }),
      INVOKE_TIMEOUT,
      `invoke(${extensionId}/${channel})`,
    )
  }

  function getRunners(): RunnerHandle[] {
    return [...runners.values()]
  }

  function broadcastChatEvent(event: string, payload: unknown): void {
    for (const handle of runners.values()) {
      try {
        handle.proc.postMessage({ kind: "chat.event", event, payload })
      } catch {
        // Best-effort; see createRunnerManager twin for the rationale.
      }
    }
  }

  return {
    activateExtension,
    deactivateExtension,
    invokeExtensionChannel,
    getRunners,
    broadcastChatEvent,
  }
}
