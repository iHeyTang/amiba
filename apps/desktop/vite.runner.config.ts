/**
 * Vite config for the extension-runner bundle.
 *
 * The runner is a Node.js CJS bundle that runs inside Electron's
 * utilityProcess (one instance per extension). It must be built
 * separately from the electron-vite targets (main/preload/renderer)
 * because electron-vite only supports those three target roles.
 *
 * Output: out/extension-runner/index.js
 * Desktop main resolves it via:
 *   path.join(__dirname, "../extension-runner/index.js")
 */

import { resolve } from "node:path"
import { defineConfig } from "vite"
import { externalizeDepsPlugin } from "electron-vite"

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
  plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
  build: {
    outDir: "out/extension-runner",
    emptyOutDir: true,
    lib: {
      entry: resolve(
        __dirname,
        "../../packages/extension-host/src/runner/index.ts",
      ),
      formats: ["cjs"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "electron",
        // Node built-ins
        /^node:/,
        "assert", "buffer", "child_process", "cluster", "console", "constants",
        "crypto", "dgram", "diagnostics_channel", "dns", "domain", "events",
        "fs", "http", "http2", "https", "inspector", "module", "net", "os",
        "path", "perf_hooks", "process", "punycode", "querystring", "readline",
        "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
        "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
      ],
    },
  },
})
