import { resolve } from "node:path"
import kleur from "kleur"
import { readDshPluginPackage } from "../lib/plugin-package.js"
import { spawnAsync } from "../lib/child-process.js"

/**
 * Compile both halves of a standard DSH plugin. Runtime loading is owned by
 * the DSH Loader graph, never by an Electron registry or WebView host.
 */
export async function devCommand() {
  const cwd = resolve(process.cwd())
  const manifest = readDshPluginPackage(cwd)

  console.log(kleur.bold(`amiba plugin dev — ${kleur.cyan(manifest.name)}`))
  console.log(kleur.dim(`  ${cwd}`))
  console.log(kleur.bold("\nStarting build in watch mode…\n"))

  const hostProc = spawnAsync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json", "--watch"], { cwd })
  const clientProc = spawnAsync("pnpm", ["exec", "vite", "build", "--watch"], { cwd })

  const cleanup = () => {
    hostProc.kill()
    clientProc.kill()
  }

  process.on("SIGINT", () => {
    console.log(kleur.dim("\n[amiba] Stopping DSH plugin build watchers."))
    cleanup()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  await Promise.all([hostProc.exit, clientProc.exit])
}
