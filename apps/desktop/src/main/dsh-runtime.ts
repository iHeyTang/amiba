import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import { DshApiClient } from "@amiba/app-runtime/dsh-client"
import type { AgentRuntimeLogEntry, AgentRuntimeLogLevel } from "@amiba/app-runtime/platform"
import NodeWebSocket from "ws"
import {
  MANAGED_DSH_RUNTIME,
  ensureManagedDshProfile,
  resolveManagedDshRuntimeDir,
  resolveManagedDshPaths,
  resolvePackagedManagedDshRuntimeDir,
} from "@amiba/app-runtime/dsh-runtime"

const READY_TIMEOUT_MS = 90_000
const MAX_RUNTIME_LOG_ENTRIES = 5_000

export interface DshRuntimeHandle {
  baseUrl: string
  client: DshApiClient
  pluginToken: string
}

export function extractDshReadyUrl(output: string): string | null {
  const match = /(?:^|\n)dsh web: (http:\/\/[^\s]+)/u.exec(output)
  if (!match?.[1]) return null
  const url = new URL(match[1])
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error(`DSH runtime advertised a non-loopback URL: ${url.href}`)
  }
  if (!url.port) throw new Error(`DSH runtime advertised a URL without a port: ${url.href}`)
  return url.origin
}

export function managedDshPaths(): ReturnType<typeof resolveManagedDshPaths> {
  const runtimeDir = app.isPackaged
    ? resolvePackagedManagedDshRuntimeDir(process.resourcesPath)
    : resolveManagedDshRuntimeDir({
        explicit:
          process.env.AMIBA_DSH_RUNTIME_DIR?.trim() ||
          path.resolve(
            app.getAppPath(),
            "../../packages/app-runtime/resources/dsh-runtime",
          ),
        env: process.env,
      })
  return resolveManagedDshPaths(app.getPath("userData"), runtimeDir)
}

export class DshRuntimeController {
  private child: ChildProcess | null = null
  private handle: DshRuntimeHandle | null = null
  private starting: Promise<DshRuntimeHandle> | null = null
  private startedAt: number | null = null
  private lastError: string | null = null
  private stopping = false
  private logSequence = 0
  private readonly logEntries: AgentRuntimeLogEntry[] = []
  private readonly logTails: Record<"stdout" | "stderr", string> = {
    stdout: "",
    stderr: "",
  }

  private appendLog(
    stream: AgentRuntimeLogEntry["stream"],
    message: string,
    level?: AgentRuntimeLogLevel,
  ): void {
    const normalized = message.endsWith("\r") ? message.slice(0, -1) : message
    const inferred = level ?? (
      /\b(error|fatal|critical)\b/i.test(normalized)
        ? "error"
        : /\b(warn|warning)\b/i.test(normalized)
          ? "warning"
          : /\b(debug|trace)\b/i.test(normalized)
            ? "debug"
            : "info"
    )
    this.logEntries.push({
      seq: ++this.logSequence,
      ts: Date.now(),
      stream,
      level: inferred,
      message: normalized,
    })
    if (this.logEntries.length > MAX_RUNTIME_LOG_ENTRIES) {
      this.logEntries.splice(0, this.logEntries.length - MAX_RUNTIME_LOG_ENTRIES)
    }
  }

  private recordOutput(stream: "stdout" | "stderr", chunk: Buffer): void {
    let pending = this.logTails[stream] + chunk.toString()
    let newline = pending.indexOf("\n")
    while (newline >= 0) {
      this.appendLog(stream, pending.slice(0, newline))
      pending = pending.slice(newline + 1)
      newline = pending.indexOf("\n")
    }
    this.logTails[stream] = pending.slice(-64_000)
  }

  private flushOutput(): void {
    for (const stream of ["stdout", "stderr"] as const) {
      if (this.logTails[stream]) this.appendLog(stream, this.logTails[stream])
      this.logTails[stream] = ""
    }
  }

  async ensureManagedProfile(): Promise<void> {
    await ensureManagedDshProfile(managedDshPaths())
  }

  get current(): DshRuntimeHandle | null {
    return this.handle
  }

  get diagnostics() {
    const running = Boolean(this.handle && this.child?.exitCode === null)
    return {
      state: running
        ? "running" as const
        : this.starting
          ? "starting" as const
          : this.lastError
            ? "failed" as const
            : "stopped" as const,
      pid: this.child?.exitCode === null ? this.child.pid : undefined,
      startedAt: running ? this.startedAt ?? undefined : undefined,
      error: this.lastError ?? undefined,
    }
  }

  readLogs(): AgentRuntimeLogEntry[] {
    return this.logEntries.map((entry) => ({ ...entry }))
  }

  ensureStarted(): Promise<DshRuntimeHandle> {
    if (this.handle && this.child?.exitCode === null) return Promise.resolve(this.handle)
    if (this.starting) return this.starting
    this.starting = this.start()
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.appendLog("system", this.lastError, "error")
        throw error
      })
      .finally(() => {
        this.starting = null
      })
    return this.starting
  }

  private async start(): Promise<DshRuntimeHandle> {
    const managed = managedDshPaths()
    this.appendLog("system", `Starting managed DSH ${MANAGED_DSH_RUNTIME.version}.`)
    await Promise.all([
      mkdir(managed.home, { recursive: true }),
      mkdir(managed.agentsHome, { recursive: true }),
    ])
    if (
      !existsSync(managed.node) ||
      !existsSync(managed.entrypoint) ||
      managed.amibaBundleManifests.some((file) => !existsSync(file)) ||
      managed.amibaBundlePatches.some((file) => !existsSync(file))
    ) {
      throw new Error(
        `Managed DSH ${MANAGED_DSH_RUNTIME.version} is missing at ${managed.runtimeDir}. Run pnpm runtime:prepare.`,
      )
    }
    const pluginToken = randomBytes(32).toString("base64url")
    const runtimeGatewayUrl = process.env.AMIBA_RUNTIME_GATEWAY_URL
    const runtimeGatewayToken = process.env.AMIBA_RUNTIME_GATEWAY_TOKEN
    if (!runtimeGatewayUrl || !runtimeGatewayToken) {
      throw new Error("Amiba runtime gateway is unavailable before DSH startup.")
    }
    await this.ensureManagedProfile()
    const launch = { node: managed.node, entrypoint: managed.entrypoint }

    const child = spawn(
      launch.node,
      [
        launch.entrypoint,
        "--profile",
        managed.profileName,
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        // DSH 0.1.1 opens the user's default browser when it starts serving.
        // The desktop app IS the client; a second, unauthenticated tab is not
        // wanted and startled the user on first launch.
        "--no-open",
      ],
      {
        cwd: app.getPath("userData"),
        env: {
          ...process.env,
          DSH_HOME: managed.home,
          DSH_AGENTS_HOME: managed.agentsHome,
          AMIBA_DSH_API_TOKEN: pluginToken,
          AMIBA_RUNTIME_GATEWAY_URL: runtimeGatewayUrl,
          AMIBA_RUNTIME_GATEWAY_TOKEN: runtimeGatewayToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    this.child = child
    this.startedAt = Date.now()

    const baseUrl = await new Promise<string>((resolve, reject) => {
      let output = ""
      let settled = false
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const onData = (stream: "stdout" | "stderr", chunk: Buffer): void => {
        this.recordOutput(stream, chunk)
        output = `${output}${chunk.toString()}`.slice(-64_000)
        try {
          const ready = extractDshReadyUrl(output)
          if (ready) settle(() => resolve(ready))
        } catch (error) {
          settle(() => reject(error))
        }
      }
      child.stdout.on("data", (chunk: Buffer) => onData("stdout", chunk))
      child.stderr.on("data", (chunk: Buffer) => onData("stderr", chunk))
      child.once("error", (error) => {
        this.appendLog("system", error.message, "error")
        settle(() => reject(error))
      })
      child.once("exit", (code, signal) => {
        this.flushOutput()
        this.child = null
        this.handle = null
        this.startedAt = null
        if (!this.stopping && code !== 0) {
          this.lastError = `DSH runtime exited (code=${code ?? "null"}, signal=${signal ?? "none"}).`
          this.appendLog("system", this.lastError, "error")
        } else {
          this.appendLog("system", `DSH runtime stopped (code=${code ?? "null"}, signal=${signal ?? "none"}).`)
        }
        settle(() =>
          reject(
            new Error(
              `DSH runtime exited before ready (code=${code ?? "null"}, signal=${signal ?? "none"}).\n${output}`,
            ),
          ),
        )
      })
      const timer = setTimeout(() => {
        child.kill("SIGTERM")
        settle(() => reject(new Error(`DSH runtime did not become ready in ${READY_TIMEOUT_MS}ms.\n${output}`)))
      }, READY_TIMEOUT_MS)
      timer.unref()
    })

    const handle = {
      baseUrl,
      client: new DshApiClient({
        baseUrl,
        createWebSocket: (url) => new NodeWebSocket(url),
      }),
      pluginToken,
    }
    this.handle = handle
    this.lastError = null
    this.appendLog("system", `Managed DSH is ready at ${baseUrl}.`)
    return handle
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.handle = null
    this.startedAt = null
    if (!child || child.exitCode !== null) return
    this.stopping = true
    try {
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => child.kill("SIGKILL"), 5_000)
        force.unref()
        child.once("exit", () => {
          clearTimeout(force)
          resolve()
        })
        child.kill("SIGTERM")
      })
    } finally {
      this.stopping = false
    }
  }

  async restart(): Promise<DshRuntimeHandle> {
    this.appendLog("system", "Restarting managed DSH runtime.")
    await this.stop()
    return this.ensureStarted()
  }
}

export const dshRuntime = new DshRuntimeController()
