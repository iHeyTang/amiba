/**
 * Smoke tests for the runner controller.
 *
 * Because vitest runs in a plain Node.js environment (no Electron), we mock
 * the `electron` module and simulate the utilityProcess message protocol with
 * a lightweight EventEmitter-based fake process.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { EventEmitter } from "node:events"

// ── Fake UtilityProcess ──────────────────────────────────────────────────────

interface FakeUtilityProcess extends EventEmitter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postMessage: ReturnType<typeof vi.fn>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kill: ReturnType<typeof vi.fn>
  _emit(msg: unknown): void
  _exit(code: number): void
}

function makeFakeProc(): FakeUtilityProcess {
  const ee = new EventEmitter() as FakeUtilityProcess
  ee.postMessage = vi.fn()
  ee.kill = vi.fn()
  ee._emit = (msg: unknown) => ee.emit("message", msg)
  ee._exit = (code: number) => ee.emit("exit", code)
  return ee
}

// Track processes created during each test.
let createdProcs: FakeUtilityProcess[] = []

// vi.mock is hoisted, so we cannot reference `createdProcs` directly from
// the factory. Instead, we use a module-level array captured by reference.
vi.mock("electron", () => {
  return {
    utilityProcess: {
      fork: (_runnerPath: string, _args: string[], _opts: unknown) => {
        // Access the test-local array via the module scope of this file.
        // vitest's hoisting places vi.mock before variable declarations but
        // the factory's body runs lazily at require-time (i.e., when the
        // module-under-test is first imported), so `createdProcs` is already
        // declared by then (even if empty). We push into it here.
        const p = makeFakeProc()
        createdProcs.push(p)
        return p
      },
    },
  }
})

// Import AFTER the vi.mock call (hoisting ensures the mock is set up first).
import { createRunnerManagerWithRpc } from "../main/runner-controller"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOpts() {
  return {
    runnerPath: "/fake/runner.js",
    settingsStore: {
      get: vi.fn().mockResolvedValue(undefined as unknown),
      set: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      get: vi.fn().mockResolvedValue(undefined as unknown),
      set: vi.fn().mockResolvedValue(undefined),
    },
    callTool: vi.fn().mockResolvedValue({ result: "ok" }),
    activateTimeoutMs: 1000,
    shutdownTimeoutMs: 500,
    invokeTimeoutMs: 1000,
  }
}

/**
 * Simulate the runner handshake: runner.ready → (controller sends activate) → activated.
 */
function driveActivation(proc: FakeUtilityProcess, opts: { ok?: boolean; error?: string } = {}) {
  const { ok = true, error } = opts
  setImmediate(() => {
    proc._emit({ kind: "runner.ready" })
    setImmediate(() => {
      if (ok) {
        proc._emit({ kind: "activated", ok: true })
      } else {
        proc._emit({ kind: "activated", ok: false, error: error ?? "boom" })
        proc._exit(1)
      }
    })
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createRunnerManagerWithRpc", () => {
  beforeEach(() => {
    createdProcs = []
  })

  it("forks a process and resolves { ok: true } on successful activation", async () => {
    const mgr = createRunnerManagerWithRpc(makeOpts())
    const activationPromise = mgr.activateExtension("io.test.echo", "/ext/main.cjs")

    const proc = createdProcs[0]!
    driveActivation(proc)

    const result = await activationPromise
    expect(result).toEqual({ ok: true })
    expect(mgr.getRunners()).toHaveLength(1)
    expect(mgr.getRunners()[0]!.extensionId).toBe("io.test.echo")
  })

  it("returns { ok: false } when the runner reports activation failure", async () => {
    const mgr = createRunnerManagerWithRpc(makeOpts())
    const activationPromise = mgr.activateExtension("io.test.bad", "/ext/bad.cjs")
    const proc = createdProcs[0]!
    driveActivation(proc, { ok: false, error: "extension threw during activate" })

    const result = await activationPromise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/extension threw/)
    }
    expect(mgr.getRunners()).toHaveLength(0)
  })

  it("returns { ok: false } when the runner process exits before activation", async () => {
    const mgr = createRunnerManagerWithRpc(makeOpts())
    const activationPromise = mgr.activateExtension("io.test.crash", "/ext/crash.cjs")
    const proc = createdProcs[0]!

    setImmediate(() => proc._exit(1))

    const result = await activationPromise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/exited.*before activation/i)
    }
  })

  it("registers exposed channels when runner emits ipc.exposed", async () => {
    const mgr = createRunnerManagerWithRpc(makeOpts())
    const activationPromise = mgr.activateExtension("io.test.echo", "/ext/main.cjs")
    const proc = createdProcs[0]!

    setImmediate(() => {
      proc._emit({ kind: "runner.ready" })
      setImmediate(() => {
        proc._emit({ kind: "ipc.exposed", channel: "echo" })
        proc._emit({ kind: "activated", ok: true })
      })
    })

    await activationPromise

    const runner = mgr.getRunners()[0]!
    expect(runner.exposedChannels.has("echo")).toBe(true)
  })

  it("forwards invokeExtensionChannel to the runner and returns the response", async () => {
    const mgr = createRunnerManagerWithRpc(makeOpts())
    const activationPromise = mgr.activateExtension("io.test.echo", "/ext/main.cjs")
    const proc = createdProcs[0]!

    setImmediate(() => {
      proc._emit({ kind: "runner.ready" })
      setImmediate(() => {
        proc._emit({ kind: "ipc.exposed", channel: "echo" })
        proc._emit({ kind: "activated", ok: true })
      })
    })
    await activationPromise

    // When the controller sends ipc.invoke, respond with echo.
    let invokeCallCount = 0
    proc.postMessage.mockImplementation((msg: unknown) => {
      const m = msg as { kind: string; id: string; channel: string; args: unknown }
      if (m.kind === "ipc.invoke" && invokeCallCount === 0) {
        invokeCallCount++
        setImmediate(() => {
          proc._emit({ kind: "ipc.response", id: m.id, result: m.args })
        })
      }
    })

    const result = await mgr.invokeExtensionChannel("io.test.echo", "echo", { hello: "world" })
    expect(result).toEqual({ hello: "world" })
  })

  it("rejects invokeExtensionChannel for unknown channels", async () => {
    const mgr = createRunnerManagerWithRpc(makeOpts())
    const activationPromise = mgr.activateExtension("io.test.echo", "/ext/main.cjs")
    const proc = createdProcs[0]!
    driveActivation(proc)
    await activationPromise

    await expect(
      mgr.invokeExtensionChannel("io.test.echo", "nope", {}),
    ).rejects.toThrow(/has not exposed channel/)
  })

  it("deactivateExtension sends shutdown and waits for exit", async () => {
    const mgr = createRunnerManagerWithRpc(makeOpts())
    const activationPromise = mgr.activateExtension("io.test.echo", "/ext/main.cjs")
    const proc = createdProcs[0]!
    driveActivation(proc)
    await activationPromise

    // Simulate the runner acknowledging shutdown.
    proc.postMessage.mockImplementation((msg: unknown) => {
      const m = msg as { kind: string }
      if (m.kind === "shutdown") {
        setImmediate(() => proc._exit(0))
      }
    })

    await mgr.deactivateExtension("io.test.echo")
    expect(mgr.getRunners()).toHaveLength(0)
  })

  it("bridges settings.get RPC to the settingsStore", async () => {
    const opts = makeOpts()
    opts.settingsStore.get.mockResolvedValue("stored-value")

    const mgr = createRunnerManagerWithRpc(opts)
    const activationPromise = mgr.activateExtension("io.test.rpc", "/ext/main.cjs")
    const proc = createdProcs[0]!

    setImmediate(() => {
      proc._emit({ kind: "runner.ready" })
      setImmediate(() => {
        // Runner sends an RPC before signalling activated (valid race).
        proc._emit({ kind: "rpc.request", id: "rpc-1", method: "settings.get", args: { key: "mykey", fallback: null } })
        setImmediate(() => {
          proc._emit({ kind: "activated", ok: true })
        })
      })
    })

    await activationPromise

    // Wait a tick for the async RPC handler to complete.
    await new Promise((r) => setImmediate(r))

    type RpcMsg = { kind: string; id?: string; result?: unknown }
    const rpcResponses = (proc.postMessage.mock.calls as Array<[unknown]>)
      .map((c) => c[0] as RpcMsg)
      .filter((m) => m.kind === "rpc.response")

    expect(rpcResponses.length).toBeGreaterThan(0)
    const resp = rpcResponses.find((r) => r.id === "rpc-1")
    expect(resp).toBeDefined()
    expect(resp?.result).toBe("stored-value")
    expect(opts.settingsStore.get).toHaveBeenCalledWith("ext.io.test.rpc.mykey", null)
  })
})
