import { mkdirSync, utimesSync, watch as fsWatch } from "node:fs"
import { join, resolve } from "node:path"
import kleur from "kleur"
import { readExtensionManifest } from "../lib/manifest.js"
import { spawnAsync } from "../lib/child-process.js"

interface DevOptions {
  symlink?: boolean  // kept for backward-compat CLI flag parsing, ignored
}

/**
 * `hermes-x-ext dev` is purely a build/watch helper. It does NOT touch the
 * desktop's extension registry — that belongs to the desktop UI, just like
 * Chrome's `chrome://extensions` → "Load unpacked" owns adding unpacked
 * extensions, not your bundler.
 *
 * Flow:
 *   1. Read manifest at cwd (sanity-check that this is an extension dir).
 *   2. Start `vite build --watch` for main + renderer in parallel.
 *   3. Watch `dist/main.cjs` / `dist/renderer.js`; on rebuild, touch
 *      `manifest.json` so the desktop's manifest-watcher fires
 *      reloadExtension(id) — but ONLY for an extension the user has
 *      already added through the UI ("Add local extension…").
 *
 * Recommended workflow:
 *   - Terminal 1: `pnpm dev:desktop`
 *   - Terminal 2: `cd <extension dir> && pnpm dev`
 *   - In the app: Settings → Extensions → "Add local extension…"
 *     → pick the extension directory. From then on every rebuild hot-reloads.
 */
export async function devCommand(_opts: DevOptions) {
  const cwd = resolve(process.cwd())
  const manifest = readExtensionManifest(cwd)

  console.log(kleur.bold(`hermes-x-ext dev — ${kleur.cyan(manifest.id)}`))
  console.log(kleur.dim(`  ${cwd}`))
  console.log(
    kleur.dim(
      "  (this command only builds/watches; add the extension in the desktop UI:" +
        " Settings → Extensions → Add local extension…)",
    ),
  )
  console.log(kleur.bold("\nStarting build in watch mode…\n"))

  // Run vite build --watch for both configs in parallel.
  const mainProc = spawnAsync("pnpm", ["vite", "build", "--watch", "-c", "vite.main.config.ts"], { cwd })
  const rendererProc = spawnAsync(
    "pnpm",
    ["vite", "build", "--watch", "-c", "vite.renderer.config.ts"],
    { cwd },
  )

  const manifestPath = join(cwd, "manifest.json")

  // Watch the build outputs; when either changes, touch manifest.json so the
  // desktop's manifest-watcher fires reloadExtension(id) for us. Coalesce
  // back-to-back events within 200 ms so simultaneous bundle writes produce
  // exactly one manifest touch.
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
        console.log(kleur.dim(`[hermes-x-ext] manifest touched → desktop reload (if added)`))
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
  mkdirSync(distDir, { recursive: true })
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
    console.log(kleur.dim("\n[hermes-x-ext] Stopping build watchers."))
    cleanup()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  await Promise.all([mainProc.exit, rendererProc.exit])
}
