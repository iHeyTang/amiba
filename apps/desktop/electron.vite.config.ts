import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

/**
 * Our workspace packages are TypeScript source only (no build step), so they
 * must be bundled into main / preload rather than left as `require()` calls
 * — Node can't parse raw .ts at runtime. `externalizeDepsPlugin` defaults to
 * externalizing every dep in package.json; we exclude the workspace ones
 * here so Vite inlines their source through esbuild.
 */
const WORKSPACE_PKGS = [
  "@hermes-x/ui",
  "@hermes-x/core",
  "@hermes-x/ui",
  "@hermes-x/i18n",
  "@hermes-x/platform",
  "@hermes-x/ui",
  "@hermes-x/tailwind-preset",
  "@hermes-x/ui",
  "@hermes-x/ui",
  "@hermes-x/utils",
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      outDir: "out/main",
      lib: { entry: "src/main/index.ts" }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      outDir: "out/preload",
      lib: { entry: "src/preload/index.ts" }
    }
  },
  renderer: {
    root: "src/renderer",
    resolve: {
      alias: {
        "~": resolve(__dirname, "src/renderer")
      }
    },
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          notifier: resolve(__dirname, "src/renderer/notifier/index.html"),
          "quick-ask": resolve(__dirname, "src/renderer/quick-ask/index.html")
        }
      }
    },
    server: { port: 5173 }
  }
})
