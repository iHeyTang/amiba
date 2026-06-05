/**
 * packages/extension-host/src/runner/index.ts
 *
 * Runs inside an Electron utilityProcess (one per extension).
 * Bootstrapped by runner-controller.ts on the desktop main side.
 *
 * Startup args:
 *   process.argv[2] = extensionId
 *   process.argv[3] = absolute path to extension's dist/main.cjs
 *
 * Communication: parentPort (Electron utilityProcess child API).
 *
 * Note: this file is compiled by Vite/esbuild as a CJS bundle. Electron
 * and all Node built-ins are external. `parentPort` is the
 * Electron-augmented property available in utilityProcess children.
 */

import type {
  ChatEventName,
  ChatRunCompletedEvent,
  Disposable,
  HermesSessionInfo,
  IpcContext,
  MainHost,
  MainModule,
} from "@hermes-x/extension-api"

// Typed accessor for parentPort (Electron augments NodeJS.Process).
// We use a cast so the tsconfig doesn't need to pull in the full electron
// type bundle — only the subset we actually call.
interface ParentPort {
  postMessage(message: unknown): void
  on(event: "message", listener: (event: { data: unknown }) => void): this
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

// ── Types for the message protocol ──────────────────────────────────────────

interface RpcRequest {
  kind: "rpc.request"
  id: string
  method: string
  args: unknown
}

interface RpcResponse {
  kind: "rpc.response"
  id: string
  result?: unknown
  error?: string
}

interface IpcInvoke {
  kind: "ipc.invoke"
  id: string
  channel: string
  args: unknown
}

interface IpcResponse {
  kind: "ipc.response"
  id: string
  result?: unknown
  error?: string
}

interface ActivateMsg {
  kind: "activate"
}

interface ShutdownMsg {
  kind: "shutdown"
}

/**
 * Fanout from the desktop main process. Carries a chat-engine event the
 * runner forwards to whichever extension handlers subscribed via
 * `host.chat.onEvent`. The main side broadcasts to every runner — the
 * filter by event name + the handler registry both live here.
 */
interface ChatEventMsg {
  kind: "chat.event"
  event: string
  payload: unknown
}

type IncomingMessage =
  | RpcResponse
  | IpcInvoke
  | ActivateMsg
  | ShutdownMsg
  | ChatEventMsg

// ── Entry point ──────────────────────────────────────────────────────────────

const extensionId = process.argv[2]
const mainPath = process.argv[3]

if (!extensionId || !mainPath) {
  console.error("[runner] missing args: extensionId and mainPath required")
  process.exit(1)
}

// ── RPC helpers ──────────────────────────────────────────────────────────────

let rpcCounter = 0
const pendingRpcs = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function rpc(method: string, args: unknown): Promise<unknown> {
  const id = `rpc-${++rpcCounter}`
  return new Promise((resolve, reject) => {
    pendingRpcs.set(id, { resolve, reject })
    parentPort.postMessage({ kind: "rpc.request", id, method, args } satisfies RpcRequest)
  })
}

// ── Handler registry (for channels the extension exposes) ────────────────────

const handlers = new Map<string, (args: unknown, ctx: IpcContext) => Promise<unknown> | unknown>()
const bootBackgroundHandlers = new Set<() => Promise<void> | void>()
const shutdownHandlers = new Set<() => Promise<void> | void>()
const disposables: Disposable[] = []

/**
 * `event name → set of handlers` for host.chat.onEvent subscriptions.
 * Stored on the runner because the main side broadcasts indiscriminately
 * — keeping the per-event filter local saves on cross-process traffic
 * for events the extension doesn't care about.
 */
const chatEventHandlers = new Map<string, Set<(payload: unknown) => void>>()

// ── Build the MainHost proxy ─────────────────────────────────────────────────

const host: MainHost = {
  id: extensionId,

  logger: {
    debug: (...a: unknown[]) => {
      parentPort.postMessage({ kind: "log", level: "debug", args: [`[ext:${extensionId}]`, ...a] })
    },
    info: (...a: unknown[]) => {
      parentPort.postMessage({ kind: "log", level: "info", args: [`[ext:${extensionId}]`, ...a] })
    },
    warn: (...a: unknown[]) => {
      parentPort.postMessage({ kind: "log", level: "warn", args: [`[ext:${extensionId}]`, ...a] })
    },
    error: (...a: unknown[]) => {
      parentPort.postMessage({ kind: "log", level: "error", args: [`[ext:${extensionId}]`, ...a] })
    },
  },

  ipc: {
    expose: (channel, handler) => {
      handlers.set(channel, handler as (args: unknown, ctx: IpcContext) => Promise<unknown> | unknown)
      parentPort.postMessage({ kind: "ipc.exposed", channel })
      const d: Disposable = {
        dispose: () => {
          handlers.delete(channel)
          parentPort.postMessage({ kind: "ipc.unexposed", channel })
        },
      }
      disposables.push(d)
      return d
    },
  },

  lifecycle: {
    onBootBackground: (h) => {
      bootBackgroundHandlers.add(h)
      const d: Disposable = {
        dispose: () => bootBackgroundHandlers.delete(h),
      }
      disposables.push(d)
      return d
    },
    onShutdown: (h) => {
      shutdownHandlers.add(h)
      const d: Disposable = {
        dispose: () => shutdownHandlers.delete(h),
      }
      disposables.push(d)
      return d
    },
  },

  settings: {
    get: (key, fallback) => rpc("settings.get", { key, fallback }) as Promise<never>,
    set: (key, value) => rpc("settings.set", { key, value }) as Promise<void>,
  },

  storage: {
    get: (key, fallback) => rpc("storage.get", { key, fallback }) as Promise<never>,
    set: (key, value) => rpc("storage.set", { key, value }) as Promise<void>,
  },

  hermes: {
    callTool: (tool, args) => rpc("hermes.callTool", { tool, args }) as Promise<never>,
    getSession: (sessionId) =>
      rpc("hermes.getSession", { sessionId }) as Promise<HermesSessionInfo | null>,
    listSessions: (opts) =>
      rpc("hermes.listSessions", { opts }) as Promise<HermesSessionInfo[]>,
  },

  chat: {
    onEvent: ((event: ChatEventName, handler: (e: ChatRunCompletedEvent) => void) => {
      let set = chatEventHandlers.get(event)
      if (!set) {
        set = new Set()
        chatEventHandlers.set(event, set)
      }
      // Wrap in a generic adapter so the registry stores one callback shape,
      // regardless of which event-typed payload the subscriber asked for.
      const wrapped = (payload: unknown) => handler(payload as ChatRunCompletedEvent)
      set.add(wrapped)
      const d: Disposable = {
        dispose: () => {
          const s = chatEventHandlers.get(event)
          if (!s) return
          s.delete(wrapped)
          if (s.size === 0) chatEventHandlers.delete(event)
        },
      }
      disposables.push(d)
      return d
    }) as MainHost["chat"]["onEvent"],
  },
}

// ── Message dispatch ─────────────────────────────────────────────────────────

let deactivateFn: (() => Promise<void> | void) | undefined

async function handleShutdown(): Promise<void> {
  // Call extension's deactivate if provided
  if (deactivateFn) {
    try {
      await Promise.resolve(deactivateFn())
    } catch (e) {
      console.error(`[runner:${extensionId}] deactivate error:`, e)
    }
  }
  // Run all registered shutdown handlers
  await Promise.allSettled([...shutdownHandlers].map((h) => Promise.resolve(h())))
  // Dispose all registered disposables
  for (const d of disposables) {
    try { d.dispose() } catch { /* ignore */ }
  }
  process.exit(0)
}

async function handleActivate(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(mainPath) as MainModule
    await Promise.resolve(mod.activate(host))
    if (typeof mod.deactivate === "function") {
      deactivateFn = mod.deactivate
    }
    parentPort.postMessage({ kind: "activated", ok: true })

    // Fire boot-background handlers in parallel after signalling activated.
    void Promise.allSettled(
      [...bootBackgroundHandlers].map((h) =>
        Promise.resolve(h()).catch((e: unknown) => {
          console.error(`[runner:${extensionId}] onBootBackground error:`, e)
        }),
      ),
    )
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    parentPort.postMessage({ kind: "activated", ok: false, error })
    process.exit(1)
  }
}

async function handleIpcInvoke(msg: IpcInvoke): Promise<void> {
  const { id, channel, args } = msg
  const handler = handlers.get(channel)
  if (!handler) {
    parentPort.postMessage({
      kind: "ipc.response",
      id,
      error: `no handler for channel: ${channel}`,
    } satisfies IpcResponse)
    return
  }
  try {
    // ctx.windowId comes across in args payload if needed; for now expose null
    const result = await Promise.resolve(handler(args, { windowId: null }))
    parentPort.postMessage({ kind: "ipc.response", id, result } satisfies IpcResponse)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    parentPort.postMessage({ kind: "ipc.response", id, error } satisfies IpcResponse)
  }
}

// ── Wire up parentPort listener ──────────────────────────────────────────────

parentPort.on("message", (event: { data: unknown }) => {
  const msg = event.data as IncomingMessage
  switch (msg.kind) {
    case "activate":
      void handleActivate()
      break

    case "shutdown":
      void handleShutdown()
      break

    case "ipc.invoke":
      void handleIpcInvoke(msg)
      break

    case "rpc.response": {
      const pending = pendingRpcs.get(msg.id)
      if (!pending) break
      pendingRpcs.delete(msg.id)
      if (msg.error !== undefined) {
        pending.reject(new Error(msg.error))
      } else {
        pending.resolve(msg.result)
      }
      break
    }

    case "chat.event": {
      const set = chatEventHandlers.get(msg.event)
      if (!set || set.size === 0) break
      // Snapshot the set before iterating so a handler that disposes its
      // subscription mid-loop doesn't trip a concurrent-modification on
      // the live registry.
      for (const h of [...set]) {
        try {
          h(msg.payload)
        } catch (e) {
          console.error(
            `[runner:${extensionId}] chat.onEvent(${msg.event}) handler threw:`,
            e,
          )
        }
      }
      break
    }

    default:
      console.warn(`[runner:${extensionId}] unknown message kind:`, (msg as { kind: string }).kind)
  }
})

// Signal readiness so the controller knows the runner process is alive
// and message handlers are wired up. The controller will then send "activate".
parentPort.postMessage({ kind: "runner.ready" })
