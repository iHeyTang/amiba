import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * Our workspace packages are TypeScript source only (no build step), so they
 * must be bundled into main / preload rather than left as `require()` calls
 * — Node can't parse raw .ts at runtime. `externalizeDepsPlugin` defaults to
 * externalizing every dep in package.json; we exclude the workspace ones
 * here so Vite inlines their source through esbuild.
 */
const WORKSPACE_PKGS = [
  "@amiba/app-runtime",
  "@amiba/dsh-plugin-session-features",
  "@amiba/extension-sdk",
  "@amiba/i18n",
  "@amiba/ui",
];

const dshDevPort = process.env.AMIBA_DSH_DEV_PORT?.trim();

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      outDir: "out/main",
      lib: { entry: "src/main/index.ts" },
      minify: "esbuild",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    build: {
      outDir: "out/preload",
      minify: "esbuild",
      rollupOptions: {
        input: {
          // Desktop bridge (window.amiba for the main renderer).
          index: resolve(__dirname, "src/preload/index.ts"),
        },
        output: {
          // Ensure each entry produces a separate file named after its key.
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    resolve: {
      alias: {
        "~": resolve(__dirname, "src/renderer"),
      },
    },
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      minify: "esbuild",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          "quick-ask": resolve(__dirname, "src/renderer/quick-ask/index.html"),
        },
      },
    },
    server: {
      port: 15173,
      ...(dshDevPort
        ? {
            // Desktop development consumes DSH's rebuild stream through a
            // same-origin EventSource. Proxy that route to the fixed loopback
            // DSH dev port so the browser keeps its normal CORS boundary.
            proxy: {
              "/plugins/events": {
                target: `http://127.0.0.1:${dshDevPort}`,
              },
            },
          }
        : {}),
    },
  },
});
