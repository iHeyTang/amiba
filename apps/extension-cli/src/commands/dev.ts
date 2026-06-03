import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, utimesSync } from "node:fs"
import { join } from "node:path"
import kleur from "kleur"
import { readExtensionManifest } from "../lib/manifest.js"
import { resolveExtensionsDir } from "../lib/userdata.js"
import { spawnAsync } from "../lib/child-process.js"

interface DevOptions {
  symlink: boolean
}

export async function devCommand(opts: DevOptions) {
  const cwd = process.cwd()
  const manifest = readExtensionManifest(cwd)
  const extDir = resolveExtensionsDir()
  mkdirSync(extDir, { recursive: true })
  const target = join(extDir, manifest.id)

  // Set up the target slot
  if (existsSync(target)) {
    const stat = lstatSync(target)
    if (stat.isSymbolicLink()) {
      console.log(kleur.dim(`(removing existing symlink at ${target})`))
      rmSync(target)
    } else {
      throw new Error(
        `${target} already exists and is not a symlink — refusing to overwrite. ` +
          `Run \`hermes-x-ext uninstall ${manifest.id}\` from the app, or delete it manually.`,
      )
    }
  }

  if (opts.symlink) {
    symlinkSync(cwd, target, "dir")
    console.log(kleur.green("✓"), `Linked ${kleur.cyan(target)} → ${kleur.dim(cwd)}`)
  } else {
    throw new Error("--no-symlink (copy mode) not implemented yet")
  }

  console.log(kleur.bold("\nStarting build in watch mode…\n"))

  // Run vite build --watch for both configs in parallel.
  // The extension's own vite configs handle the entry points.
  const mainProc = spawnAsync("pnpm", ["vite", "build", "--watch", "-c", "vite.main.config.ts"], { cwd })
  const rendererProc = spawnAsync(
    "pnpm",
    ["vite", "build", "--watch", "-c", "vite.renderer.config.ts"],
    { cwd },
  )

  // TODO(v2): Replace this polling approach with a proper file-watcher on dist/
  // that touches manifest.json only when dist files actually change.
  // For v1 we touch every 2 s — the desktop's reload handler is idempotent.
  const manifestPath = join(cwd, "manifest.json")
  const touchInterval = setInterval(() => {
    try {
      utimesSync(manifestPath, new Date(), new Date())
    } catch {
      // ignore — manifest might not exist yet if first build hasn't completed
    }
  }, 2000)

  const cleanup = () => {
    clearInterval(touchInterval)
    mainProc.kill()
    rendererProc.kill()
  }

  process.on("SIGINT", () => {
    cleanup()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  await Promise.all([mainProc.exit, rendererProc.exit])
}
