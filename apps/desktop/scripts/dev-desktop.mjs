import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import { access } from "node:fs/promises"
import process from "node:process"
import { fileURLToPath } from "node:url"

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workspaceDir = path.resolve(desktopDir, "../..")
const runtimePackageDir = path.resolve(desktopDir, "../../packages/app-runtime")
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const infoOnly = process.argv.includes("--runtime-info")

function fail(message, hint = "Run: pnpm runtime:prepare") {
  console.error(`[desktop:dev] ${message}${hint ? `\n[desktop:dev] ${hint}` : ""}`)
  process.exit(1)
}

const prepare = spawnSync(pnpm, ["runtime:prepare"], {
  cwd: runtimePackageDir,
  env: process.env,
  stdio: "inherit",
})
if (prepare.error) fail(`could not prepare DSH Runtime: ${prepare.error.message}`)
if (prepare.status !== 0) {
  fail(`DSH Runtime preparation exited with ${prepare.status ?? "unknown"}`)
}

const { resolveManagedDshRuntimeDir, verifyManagedDshRuntime } = await import(
  "@amiba/app-runtime/dsh-runtime"
)
const runtimeDir = resolveManagedDshRuntimeDir({ env: process.env })
let marker
try {
  marker = verifyManagedDshRuntime({ runtimeDir })
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

console.log(
  [
    "[desktop:dev] Amiba shared Runtime — managed DSH",
    `  DSH       ${marker.dshVersion}`,
    `  Bundle    ${marker.platform}-${marker.arch} · schema ${marker.schemaVersion}`,
    `  Toolchain Node ${marker.nodeVersion}`,
    `  Source    ${marker.nodeSource ?? "manifest-pinned download"}`,
    `  Built     ${marker.builtAt ?? "unknown"}`,
    `  Runtime   ${runtimeDir}`,
  ].join("\n"),
)

if (infoOnly) process.exit(0)

const { workspacePackages } = await import("./dsh-client-dependencies.mjs")
const packages = await workspacePackages(workspaceDir)
const projects = [...packages.values()].filter(pkg => pkg.directory.startsWith(path.join(workspaceDir, "plugins") + path.sep)).map(pkg => pkg.directory)
// A valid managed runtime can outlive locally deleted lib/ directories.
const { buildDevelopmentProject } = await import("@amiba/app-runtime/dsh-runtime")
for (const directory of projects) {
  try { await access(path.join(directory, "lib/index.js")) }
  catch { await buildDevelopmentProject(directory) }
}
const desktopEnv = { ...process.env, AMIBA_DSH_DEV_PROJECTS: JSON.stringify(projects) }
if (!desktopEnv.AMIBA_AGENT_RUNTIME) desktopEnv.AMIBA_AGENT_RUNTIME = "dsh"
if (!desktopEnv.AMIBA_DSH_DEV_PORT) desktopEnv.AMIBA_DSH_DEV_PORT = "15174"

const pluginWatcher = spawn(
  process.execPath,
  [
    path.join(desktopDir, "scripts/watch-dsh-clients.mjs"),
  ],
  {
    cwd: workspaceDir,
    env: desktopEnv,
    stdio: ["inherit", "pipe", "inherit"],
  },
)

const watcherReady = new Promise((resolve, reject) => {
  let output = ""
  pluginWatcher.stdout.setEncoding("utf8")
  pluginWatcher.stdout.on("data", (chunk) => {
    process.stdout.write(chunk)
    output = `${output}${chunk}`.slice(-4096)
    if (output.includes("[desktop:hmr] watching ")) resolve()
  })
  pluginWatcher.once("error", reject)
  pluginWatcher.once("exit", (code, signal) => {
    reject(new Error(`plugin watcher exited before readiness (${signal ?? code ?? "unknown"})`))
  })
})

try {
  await watcherReady
} catch (error) {
  if (pluginWatcher.exitCode === null) pluginWatcher.kill("SIGTERM")
  fail(
    `could not initialize plugin watcher: ${
      error instanceof Error ? error.message : String(error)
    }`,
    "See the plugin build error above.",
  )
}

// Runtime preparation and verification already happened above. Invoke the
// dev server directly; both public development commands use this launcher.
const child = spawn(pnpm, ["exec", "electron-vite", "dev"], {
  cwd: desktopDir,
  env: desktopEnv,
  stdio: "inherit",
})

let stopping = false
function stopTogether(source, code, signal) {
  if (stopping) return
  stopping = true
  const sibling = source === child ? pluginWatcher : child
  if (sibling.exitCode === null) sibling.kill("SIGTERM")
  process.exitCode = code ?? (signal ? 1 : 0)
}

for (const [label, processChild] of [
  ["desktop", child],
  ["plugin watcher", pluginWatcher],
]) {
  processChild.on("error", (error) => {
    console.error(`[desktop:dev] could not start ${label}: ${error.message}`)
    stopTogether(processChild, 1, null)
  })
  processChild.on("exit", (code, signal) => {
    stopTogether(processChild, code, signal)
  })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (stopping) return
    stopping = true
    if (child.exitCode === null) child.kill(signal)
    if (pluginWatcher.exitCode === null) pluginWatcher.kill(signal)
  })
}
