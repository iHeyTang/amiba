import { mkdirSync, utimesSync, watch as fsWatch } from "node:fs"
import { join, resolve } from "node:path"
import kleur from "kleur"
import { readExtensionManifest } from "../lib/manifest.js"
import { addLocalEntry, findLocalEntry, resolveRegistryPath } from "../lib/registry.js"
import { spawnAsync } from "../lib/child-process.js"

interface DevOptions {
  symlink?: boolean  // kept for backward-compat CLI flag parsing, ignored
}

export async function devCommand(_opts: DevOptions) {
  const cwd = resolve(process.cwd())
  const manifest = readExtensionManifest(cwd)
  const registryPath = resolveRegistryPath()

  // Check if already registered at a different path (refuse with clear error).
  const existing = findLocalEntry(registryPath, manifest.id)
  if (existing && existing.path !== cwd) {
    console.error(
      kleur.red("✗"),
      `Extension "${manifest.id}" is already registered at a different path:\n  ${existing.path}\n\n` +
      `Uninstall it from the app first, then run \`hermes-x-ext dev\` again from the new path.`,
    )
    process.exit(1)
  }

  // Register (or re-register with same path) the local entry.
  try {
    addLocalEntry(registryPath, manifest.id, cwd)
    console.log(
      kleur.green("✓"),
      `Registered ${kleur.cyan(manifest.id)} in registry at ${kleur.dim(registryPath)}`,
    )
    console.log(kleur.dim(`  path: ${cwd}`))
  } catch (e) {
    console.error(kleur.red("✗"), e instanceof Error ? e.message : String(e))
    process.exit(1)
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

  // On SIGINT/SIGTERM: stop the build watchers but leave the registry entry
  // in place — user can clean up via UI uninstall or a future CLI command.
  process.on("SIGINT", () => {
    console.log(kleur.dim("\n[hermes-x-ext] Stopping build watchers. Registry entry kept."))
    cleanup()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  await Promise.all([mainProc.exit, rendererProc.exit])
}
