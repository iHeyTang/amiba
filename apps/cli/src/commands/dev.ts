import { mkdirSync, utimesSync, watch as fsWatch } from "node:fs"
import { join, resolve } from "node:path"
import kleur from "kleur"
import { readExtensionManifest } from "../lib/manifest.js"
import { spawnAsync } from "../lib/child-process.js"

interface DevOptions {
  symlink?: boolean  // kept for backward-compat CLI flag parsing, ignored
}

/**
 * `amiba dev` is purely a build/watch helper. It does NOT touch the
 * desktop's extension registry — that belongs to the desktop UI, just like
 * Chrome's `chrome://extensions` → "Load unpacked" owns adding unpacked
 * extensions, not your bundler.
 *
 * Flow:
 *   1. Read manifest at cwd (sanity-check that this is an extension dir).
 *   2. Start `vite build --watch` for main + UI in parallel.
 *   3. Watch `dist/` recursively; on any change, touch `manifest.json` so
 *      the desktop's manifest-watcher fires reloadExtension(id) — but ONLY
 *      for an extension the user has already added through the UI
 *      ("Add local extension…").
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

  console.log(kleur.bold(`amiba dev — ${kleur.cyan(manifest.id)}`))
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
  const uiProc = spawnAsync(
    "pnpm",
    ["vite", "build", "--watch", "-c", "vite.ui.config.ts"],
    { cwd },
  )

  const manifestPath = join(cwd, "manifest.json")

  // Watch the dist/ directory recursively; when anything changes, touch
  // manifest.json so the desktop's manifest-watcher fires reloadExtension(id).
  // Coalesce back-to-back events within 200 ms so simultaneous bundle writes
  // produce exactly one manifest touch.
  const distDir = join(cwd, "dist")
  let touchTimer: NodeJS.Timeout | null = null
  const scheduleTouch = () => {
    if (touchTimer) return
    touchTimer = setTimeout(() => {
      touchTimer = null
      try {
        const now = new Date()
        utimesSync(manifestPath, now, now)
        console.log(kleur.dim(`[amiba] manifest touched → desktop reload (if added)`))
      } catch { /* manifest may not exist yet on first build */ }
    }, 200)
  }

  mkdirSync(distDir, { recursive: true })
  let dirWatcher: ReturnType<typeof fsWatch> | null = null
  try {
    dirWatcher = fsWatch(distDir, { recursive: true }, () => scheduleTouch())
  } catch (e) {
    console.warn(kleur.yellow("⚠"), `Could not watch ${distDir}; manifest hot-reload disabled:`, e)
  }

  const cleanup = () => {
    if (touchTimer) clearTimeout(touchTimer)
    if (dirWatcher) dirWatcher.close()
    mainProc.kill()
    uiProc.kill()
  }

  process.on("SIGINT", () => {
    console.log(kleur.dim("\n[amiba] Stopping build watchers."))
    cleanup()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(0)
  })

  await Promise.all([mainProc.exit, uiProc.exit])
}
