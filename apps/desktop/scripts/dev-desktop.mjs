import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const runtimePackageDir = path.resolve(desktopDir, "../../packages/app-runtime")
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const infoOnly = process.argv.includes("--runtime-info")

function fail(message) {
  console.error(
    `[desktop:dev] ${message}\n[desktop:dev] Run: pnpm runtime:prepare`,
  )
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

const {
  resolveManagedDshRuntimeDir,
  verifyManagedDshRuntime,
} = await import("@amiba/app-runtime/dsh-runtime")
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
    `  DSH       ${marker.dshVersion} (${String(marker.dshCommit).slice(0, 12)})`,
    `  Bundle    ${marker.platform}-${marker.arch} · schema ${marker.schemaVersion}`,
    `  Toolchain Node ${marker.nodeVersion}`,
    `  Source    ${marker.nodeSource ?? "manifest-pinned download"}`,
    `  Built     ${marker.builtAt ?? "unknown"}`,
    `  Runtime   ${runtimeDir}`,
  ].join("\n"),
)

if (infoOnly) process.exit(0)

const desktopEnv = { ...process.env }
if (!desktopEnv.AMIBA_AGENT_RUNTIME) desktopEnv.AMIBA_AGENT_RUNTIME = "dsh"

const child = spawn(pnpm, ["dev"], {
  cwd: desktopDir,
  env: desktopEnv,
  stdio: "inherit",
})

child.on("error", (error) => {
  console.error(`[desktop:dev] could not start desktop: ${error.message}`)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
