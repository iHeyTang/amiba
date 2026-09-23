import { watch, existsSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import kleur from "kleur"
import { buildDevelopmentProject, resolveAmibaDshDevelopmentHomes, type DesktopDevelopmentTarget, type DesktopDevelopmentEndpoint } from "@amiba/app-runtime/dsh-runtime"
import { discoverDevelopmentEndpoint } from "../lib/development-connection.js"
import { readDshPluginPackage } from "../lib/plugin-package.js"

export async function devCommand(options: { connect?: boolean; home?: string; target?: DesktopDevelopmentTarget } = {}) {
  const cwd = await realpath(resolve(process.cwd()))
  const manifest = readDshPluginPackage(cwd)
  console.log(kleur.bold(`amiba plugin dev — ${kleur.cyan(manifest.name)}`))
  let endpoint: DesktopDevelopmentEndpoint | undefined
  if (options.connect !== false) {
    endpoint = await discoverDevelopmentEndpoint(resolveAmibaDshDevelopmentHomes(options.home, process.env, process.platform, undefined, options.target))
  }
  async function request(operation: string, body: object) {
    const response = await fetch(new URL(operation, endpoint!.url), {
      method: "POST", headers: { Authorization: `Bearer ${endpoint!.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    })
    const result = await response.json() as { id?: string; error?: string }
    if (!response.ok) throw new Error(result.error ?? `Amiba returned ${response.status}`)
    return result
  }
  let session: string | undefined
  let closing = false
  let pending = false
  let build: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const abort = new AbortController()
  let finish!: () => void
  const stopped = new Promise<void>(resolve => { finish = resolve })
  const watchers: ReturnType<typeof watch>[] = []
  const rebuild = () => {
    if (closing) return
    pending = true
    if (build) return
    build = (async () => {
      while (pending && !closing) {
        pending = false
        try {
          await buildDevelopmentProject(cwd, { signal: abort.signal })
          console.log(kleur.green("[amiba] Plugin updated."))
        } catch (error) {
          if (!closing) console.error("[amiba] Build failed; keeping the previous plugin.", error)
        }
      }
    })().finally(() => { build = undefined })
  }
  const changed = (_event: string, name: string | Buffer | null) => {
    if (!name || String(name).includes(".timestamp-") || /(?:^|[/\\])(?:lib|node_modules|\.git|\.amiba-build-[^/\\]+)(?:[/\\]|$)|\.(?:test|spec)\.[jt]sx?$|\.generated\.[jt]sx?$/u.test(String(name))) return
    clearTimeout(timer)
    timer = setTimeout(rebuild, 150)
  }
  async function stop() {
    if (closing) return
    closing = true
    clearTimeout(timer)
    clearInterval(heartbeat)
    for (const watcher of watchers) watcher.close()
    abort.abort()
    await build?.catch(() => {})
    if (session) {
      try { await request("/disconnect", { id: session }) }
      catch (error) { console.error("[amiba] Disconnect failed; Amiba will expire the session automatically.", error) }
    }
    finish()
  }
  const signal = () => { void stop() }
  process.once("SIGINT", signal)
  process.once("SIGTERM", signal)
  try {
    // Watch before the initial build so an edit during startup is not lost.
    for (const directory of ["src", "scripts"]) {
      if (existsSync(join(cwd, directory))) watchers.push(watch(join(cwd, directory), { recursive: true }, changed))
    }
    watchers.push(watch(cwd, (event, name) => {
      if (name && /^(?:package\.json|(?:tsconfig|vite|tailwind|postcss).*\.[cm]?[jt]s(?:on)?)$/u.test(String(name))) changed(event, name)
    }))
    for (const watcher of watchers) watcher.on("error", error => { console.error(error); process.exitCode = 1; void stop() })
    build = buildDevelopmentProject(cwd, { signal: abort.signal })
    try { await build } finally { build = undefined }
    if (closing) return
    if (endpoint) {
      session = (await request("/connect", { directory: cwd })).id
      if (!session) throw new Error("Amiba did not return a development session")
      if (closing) { await request("/disconnect", { id: session }); return }
      heartbeat = setInterval(() => {
        void request("/heartbeat", { id: session }).catch(error => {
          console.error("[amiba] Desktop development connection lost.", error)
          process.exitCode = 1
          void stop()
        })
      }, 15_000)
      console.log(kleur.green("[amiba] Connected to Amiba. Host, client and native changes update automatically. Ctrl+C disconnects."))
    }
    if (pending) rebuild()
    await stopped
  } finally {
    await stop()
    process.off("SIGINT", signal)
    process.off("SIGTERM", signal)
  }
}
