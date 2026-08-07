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
  "@amiba/core",
  "@amiba/extension-api",
  "@amiba/extension-host",
  "@amiba/i18n",
  "@amiba/platform",
  "@amiba/tailwind-preset",
  "@amiba/ui",
  "@amiba/utils",
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
      rollupOptions: {
        input: {
          // Desktop bridge (window.amiba for the main renderer).
          index: resolve(__dirname, "src/preload/index.ts"),
          // Webview bridge (window.amiba for extension WebViews).
          "webview-bridge": resolve(__dirname, "src/preload/webview-bridge.ts"),
        },
        output: {
          // Ensure each entry produces a separate file named after its key.
          entryFileNames: "[name].js",
        },
      },
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
    server: { port: 15173 }
  }
})
