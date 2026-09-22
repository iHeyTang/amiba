import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { app, BrowserWindow } from "electron"
import { PluginStartupGate } from "./plugin-startup-gate"
import { prepareSafeProfile, countUserStartupPlugins } from "./plugin-startup-profile"
import { DshApiClient } from "@amiba/app-runtime/dsh-client"
import type { AgentRuntimeLogEntry, AgentRuntimeLogLevel } from "@amiba/app-runtime/platform"
import NodeWebSocket from "ws"
import {
  MANAGED_DSH_RUNTIME,
  managedDshEnvironment,
  createDevelopmentProfile,
  ensureManagedDshProfile,
  resolveManagedDshRuntimeDir,
  resolveManagedDshPaths,
  resolvePackagedManagedDshRuntimeDir,
} from "@amiba/app-runtime/dsh-runtime"
import { servePluginDevelopment } from "./plugin-development"
import { resolveDshListenPort } from "../shared/dsh-dev-port"

const READY_TIMEOUT_MS = 90_000
const MAX_RUNTIME_LOG_ENTRIES = 5_000

export interface DshRuntimeHandle {
  baseUrl: string
  client: DshApiClient
  pluginToken: string
  browserCookie?: string
}

export function extractDshReadyUrl(output: string): string | null {
  const match = /(?:^|\n)dsh web: (http:\/\/[^\s]+)/u.exec(output)
  if (!match?.[1]) return null
  const url = new URL(match[1])
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error(`DSH runtime advertised a non-loopback URL: ${url.href}`)
  }
  if (!url.port) throw new Error(`DSH runtime advertised a URL without a port: ${url.href}`)
  return url.searchParams.has("token") ? url.href : url.origin
}

let developmentProfile: Awaited<ReturnType<typeof createDevelopmentProfile>> | undefined

export function installedDshPaths(): ReturnType<typeof resolveManagedDshPaths> {
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

export function managedDshPaths(): ReturnType<typeof resolveManagedDshPaths> {
  return developmentProfile?.paths ?? installedDshPaths()
}

export class DshRuntimeController {
  private safeProfile?: Awaited<ReturnType<typeof prepareSafeProfile>>
  private startupGate?: PluginStartupGate
  private recovering?: Promise<void>
  private startupWatchdog?: ReturnType<typeof setTimeout>
  private startupGeneration = 0
  private get gate(): PluginStartupGate {
    return this.startupGate ??= new PluginStartupGate(
      path.join(app.getPath("userData"), "plugin-startup.json"),
      async () => {
        const paths = installedDshPaths()
        this.safeProfile = await prepareSafeProfile(paths)
        await ensureManagedDshProfile(paths)
        return countUserStartupPlugins(paths, this.safeProfile.name)
      },
      state => {
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("plugin-startup:state", state)
        if (state.phase === "loading" && !this.startupWatchdog) {
          this.startupWatchdog = setTimeout(() => { void this.recoverSafeStartup().catch(console.error) }, 90_000)
        }
      },
    )
  }
  presentPluginStartup() { return this.gate.present() }
  get activeProfileManifest(): string {
    return this.gate.safe && this.safeProfile
      ? path.join(installedDshPaths().home, "profiles", this.safeProfile.name, "package.json")
      : managedDshPaths().profileManifest
  }
  async choosePluginStartup(choice: "continue" | "safe"): Promise<void> {
    if (choice !== "continue" && choice !== "safe") throw new Error("Invalid startup choice")
    const loading = this.gate.state.phase === "loading"
    if (choice === "safe" && loading) return this.recoverSafeStartup()
    await this.gate.choose(choice)
  }
  async pluginStartupReady(): Promise<void> {
    clearTimeout(this.startupWatchdog)
    this.startupWatchdog = undefined
    await this.gate.ready()
  }
  async pluginStartupFailed(): Promise<void> { await this.gate.failed() }
  recoverSafeStartup(): Promise<void> {
    return this.recovering ??= (async () => {
      await this.gate.failed()
      await this.gate.choose("safe")
      this.startupGeneration++
      clearTimeout(this.startupWatchdog)
      this.startupWatchdog = undefined
      await this.stop()
      await this.starting?.catch(() => {})
      await this.ensureStarted()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.reload()
      }
    })().finally(() => { this.recovering = undefined })
  }
  private transition: Promise<unknown> | null = null
  private closing = false
  private withTransition<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.transition ?? Promise.resolve()
    const result = previous.catch(() => {}).then(action)
    this.transition = result
    void result.finally(() => { if (this.transition === result) this.transition = null }).catch(() => {})
    return result
  }

  private developmentServer: Awaited<ReturnType<typeof servePluginDevelopment>> | undefined
  private readonly developmentListeners = new Set<() => void>()
  onDevelopmentChanged(listener: () => void): void { this.developmentListeners.add(listener) }
  private authorProjects: string[] | undefined

  private changeDevelopmentProjects(directories: string[]): Promise<void> {
    return this.withTransition(async () => {
    const base = installedDshPaths()
    await ensureManagedDshProfile(base)
    const all = [...(this.authorProjects ?? []), ...directories]
    const next = all.length ? await createDevelopmentProfile(base, all, this.authorProjects) : undefined
    const previous = developmentProfile
    await this.stop()
    developmentProfile = next
    try {
      await this.ensureStartedUnblocked()
      await previous?.dispose()
      for (const listener of this.developmentListeners) listener()
    } catch (error) {
      await this.stop()
      developmentProfile = previous
      await next?.dispose()
      await this.ensureStartedUnblocked()
      throw error
    }
    })
  }

  async closeDevelopment(): Promise<void> {
    this.closing = true
    await this.developmentServer?.close()
    this.developmentServer = undefined
    await this.stop()
    await developmentProfile?.dispose()
    developmentProfile = undefined
  }

  private readonly stoppedListeners = new Set<() => void>()
  onStopped(listener: () => void): () => void {
    this.stoppedListeners.add(listener)
    return () => { this.stoppedListeners.delete(listener) }
  }
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
    const normalized = (message.endsWith("\r") ? message.slice(0, -1) : message).replace(/([?&]token=)[^\s&]+/gu, "$1[redacted]")
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

  assertPluginMutationAllowed(): void {
    if (developmentProfile) throw new Error("Finish local plugin development before installing, updating, or removing published plugins.")
  }

  async ensureManagedProfile(): Promise<void> {
    await ensureManagedDshProfile(installedDshPaths())
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
    if (this.closing) return Promise.reject(new Error("Amiba is shutting down"))
    if (this.transition) return this.transition.then(() => this.ensureStarted())
    return this.ensureStartedUnblocked()
  }

  private ensureStartedUnblocked(): Promise<DshRuntimeHandle> {
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
    await this.gate.wait()
    const generation = this.startupGeneration
    if (!this.gate.safe && !this.authorProjects) {
      this.authorProjects = !app.isPackaged && process.env.AMIBA_DSH_DEV_PROJECTS
        ? JSON.parse(process.env.AMIBA_DSH_DEV_PROJECTS) : []
      if (this.authorProjects!.length) {
        const base = installedDshPaths()
        await ensureManagedDshProfile(base)
        developmentProfile = await createDevelopmentProfile(base, this.authorProjects!, this.authorProjects!)
      }
    }
    const managed = this.gate.safe ? installedDshPaths() : managedDshPaths()
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
    if (!this.gate.safe) await this.ensureManagedProfile()
    const launch = { node: managed.node, entrypoint: managed.entrypoint }
    const listenPort = resolveDshListenPort(app.isPackaged)

    if (generation !== this.startupGeneration) throw new Error("Startup replaced by safe mode")
    const child = spawn(
      launch.node,
      [
        ...(this.gate.safe ? [this.safeProfile!.launcher] : [
          ...(developmentProfile ? ["--import", pathToFileURL(developmentProfile.preload).href] : []),
          launch.entrypoint, "--profile", managed.profileName,
          ...(developmentProfile ? ["--patch", developmentProfile.overlay] : []),
        ]),
        "--host",
        "127.0.0.1",
        "--port",
        listenPort,
        // DSH 0.1.1 opens the user's default browser when it starts serving.
        // The desktop app IS the client; a second, unauthenticated tab is not
        // wanted and startled the user on first launch.
        "--no-open",
      ],
      {
        cwd: app.getPath("userData"),
        env: {
          ...managedDshEnvironment(managed),
          AMIBA_DSH_API_TOKEN: pluginToken,
          AMIBA_RUNTIME_GATEWAY_URL: runtimeGatewayUrl,
          AMIBA_RUNTIME_GATEWAY_TOKEN: runtimeGatewayToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    this.child = child
    this.startedAt = Date.now()

    const launchUrl = await new Promise<string>((resolve, reject) => {
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
        for (const listener of this.stoppedListeners) listener()
        this.flushOutput()
        this.child = null
        this.handle = null
        this.startedAt = null
        if (!this.stopping && code !== 0) {
          void this.gate.failed().catch(console.error)
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

    const baseUrl = new URL(launchUrl).origin
    let browserCookie: string | undefined
    if (new URL(launchUrl).searchParams.has("token")) {
      const exchange = await fetch(launchUrl, { redirect: "manual", signal: AbortSignal.timeout(15_000) })
      if (exchange.status !== 303) throw new Error(`DSH browser authentication failed (HTTP ${exchange.status})`)
      browserCookie = exchange.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ")
      if (!browserCookie) throw new Error("DSH browser authentication omitted its session cookie")
    }
    const handle = {
      baseUrl,
      browserCookie,
      client: new DshApiClient({
        baseUrl,
        fetch: (url, init) => {
          const headers = new Headers(init?.headers)
          if (browserCookie) headers.set("cookie", browserCookie)
          return fetch(url, { ...init, headers })
        },
        createWebSocket: (url) => new NodeWebSocket(url, { headers: browserCookie ? { Cookie: browserCookie } : {} }),
      }),
      pluginToken,
    }
    if (generation !== this.startupGeneration) throw new Error("Startup replaced by safe mode")
    this.handle = handle
    // The plugin-development discovery server is only useful while authoring
    // local plugins (`amiba plugin dev` + hot reload). It was previously
    // started unconditionally, so packaged releases ran a loopback HTTP
    // server + 5s lease timer + discovery-file writes for nothing. Gate it on
    // an actual development profile (only created when
    // `!app.isPackaged && AMIBA_DSH_DEV_PROJECTS` is set).
    if (!this.gate.safe && developmentProfile && !this.developmentServer) {
      this.developmentServer = await servePluginDevelopment({
        home: installedDshPaths().home,
        change: directories => this.changeDevelopmentProjects(directories),
      })
    }
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
    return this.withTransition(async () => {
      await this.stop()
      return this.ensureStartedUnblocked()
    })
  }
}

export const dshRuntime = new DshRuntimeController()
