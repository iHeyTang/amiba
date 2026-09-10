import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import autoprefixer from "autoprefixer"
import tailwindcss from "tailwindcss"
import { build } from "vite"

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workspaceDir = path.resolve(desktopDir, "../..")
const pluginsDir = path.join(workspaceDir, "plugins")
const runtimeDir = process.env.AMIBA_DSH_RUNTIME_DIR?.trim()
  ? path.resolve(process.env.AMIBA_DSH_RUNTIME_DIR)
  : path.join(workspaceDir, "packages/app-runtime/resources/dsh-runtime")

async function discoverClientPlugins() {
  const plugins = []
  for (const entry of await fsp.readdir(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = path.join(pluginsDir, entry.name)
    const manifestPath = path.join(directory, "package.json")
    if (!fs.existsSync(manifestPath)) continue
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
    if (!manifest.dsh?.client || typeof manifest.name !== "string") continue
    if (!manifest.name.startsWith("@amiba/")) continue
    const installedLib = path.join(
      runtimeDir,
      "app/node_modules/@amiba",
      manifest.name.slice("@amiba/".length),
      "lib",
    )
    if (!fs.existsSync(installedLib)) {
      throw new Error(`managed runtime is missing ${manifest.name}; run pnpm runtime:prepare`)
    }
    plugins.push({ directory, installedLib, name: manifest.name })
  }
  return plugins.sort((left, right) => left.name.localeCompare(right.name))
}

function attachBuildLog(watcher, name) {
  let initialBuild = true
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  watcher.on("event", (event) => {
    if (event.code === "BUNDLE_END") {
      const verb = initialBuild ? "ready" : "updated"
      if (initialBuild) resolveReady()
      initialBuild = false
      console.log(`[desktop:hmr] ${verb} ${name} (${event.duration}ms)`)
      void event.result.close()
      return
    }
    if (event.code === "ERROR") {
      if (initialBuild) rejectReady(event.error)
      console.error(`[desktop:hmr] ${name} build failed`)
      console.error(event.error instanceof Error ? event.error.message : String(event.error))
    }
  })
  return ready
}

async function main() {
  const plugins = await discoverClientPlugins()
  const watchers = []
  const initialBuilds = []
  for (const plugin of plugins) {
    const result = await build({
      root: plugin.directory,
      configFile: path.join(plugin.directory, "vite.config.ts"),
      mode: "development",
      clearScreen: false,
      // Third-party "use client" directives are harmless in these CJS
      // bundles and otherwise repeat once per watcher, drowning the useful
      // ready/updated lines during development. Watch errors are reported by
      // the Rollup event handler below.
      logLevel: "silent",
      ...(fs.existsSync(path.join(plugin.directory, "postcss.config.cjs"))
        ? {
            css: {
              // Programmatic Vite builds do not change process.cwd for each
              // watcher. Construct this plugin's PostCSS chain explicitly so
              // Tailwind resolves the same config as its package-local build.
              postcss: {
                plugins: [
                  tailwindcss({
                    config: path.join(plugin.directory, "tailwind.config.cjs"),
                  }),
                  autoprefixer(),
                ],
              },
            },
          }
        : {}),
      build: {
        // Keep the immutable install/build path for production, but write dev
        // client bundles directly into the running managed runtime. DSH's own
        // client-HMR service watches these exact files and publishes revisions.
        outDir: plugin.installedLib,
        emptyOutDir: false,
        watch: {
          exclude: ["**/node_modules/**", "**/lib/**"],
        },
        rollupOptions: {
          onwarn(warning, warn) {
            if (warning.code === "MODULE_LEVEL_DIRECTIVE") return
            warn(warning)
          },
        },
      },
    })
    if (!result || Array.isArray(result) || typeof result.on !== "function") {
      throw new Error(`Vite did not create a watcher for ${plugin.name}`)
    }
    initialBuilds.push(attachBuildLog(result, plugin.name))
    watchers.push(result)
  }

  await Promise.all(initialBuilds)
  console.log(`[desktop:hmr] watching ${watchers.length} workspace client plugins`)

  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await Promise.allSettled(watchers.map((watcher) => watcher.close()))
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void close().finally(() => process.exit(0))
    })
  }
}

main().catch((error) => {
  console.error(`[desktop:hmr] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
