import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, utimesSync, watch as fsWatch } from "node:fs"
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

  const manifestPath = join(cwd, "manifest.json")

  // Watch the build outputs; when either changes, touch manifest.json so the
  // desktop's manifest-watcher fires reloadExtension(id) for us. fsWatch fires
  // fast and idempotent, so debouncing isn't strictly needed for correctness,
  // but we coalesce rapid back-to-back events within 200 ms to avoid touching
  // the manifest several times in a row when vite emits both bundles around
  // the same instant.
  const distDir = join(cwd, "dist")
  const watchTargets = ["main.cjs", "renderer.js"]
  let touchTimer: NodeJS.Timeout | null = null
  const scheduleTouch = () => {
    if (touchTimer) return
    touchTimer = setTimeout(() => {
      touchTimer = null
      try {
        const now = new Date()
        utimesSync(manifestPath, now, now)
        console.log(kleur.dim(`[hermes-x-ext] manifest touched → desktop reload`))
      } catch { /* manifest may not exist yet on first build */ }
    }, 200)
  }
  const distWatchers: ReturnType<typeof fsWatch>[] = []
  const armDistWatchers = () => {
    for (const w of distWatchers.splice(0)) w.close()
    for (const file of watchTargets) {
      try {
        const w = fsWatch(join(distDir, file), () => scheduleTouch())
        distWatchers.push(w)
      } catch {
        // file may not exist yet; will be re-armed on next dir change
      }
    }
  }
  // Watch the dist dir itself so we re-arm when files first appear after the
  // initial build.
  mkdirSync(distDir, { recursive: true })  // make the watch target exist
  let dirWatcher: ReturnType<typeof fsWatch> | null = null
  try {
    dirWatcher = fsWatch(distDir, () => armDistWatchers())
    armDistWatchers()
  } catch (e) {
    console.warn(kleur.yellow("⚠"), `Could not watch ${distDir}; manifest hot-reload disabled:`, e)
  }

  const cleanup = () => {
    if (touchTimer) clearTimeout(touchTimer)
    if (dirWatcher) dirWatcher.close()
    for (const w of distWatchers) w.close()
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
