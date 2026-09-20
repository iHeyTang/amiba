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
      minify: "esbuild",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          // The runtime host is a separate bundle because it runs in its own
          // `utilityProcess` (Electron gives a utility process no `app`, so it
          // cannot share the app entry).
          "chat-engine-worker": resolve(
            __dirname,
            "src/main/chat-engine/worker-entry.ts",
          ),
        },
        output: {
          // Electron's main process and its utility children load CommonJS.
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
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
        // Pet page sources (see tsconfig paths): compile the pets client and
        // notification-hub model/client straight from source instead of the
        // plugins' built app bundles.
        "@amiba/dsh-plugin-pets/model": resolve(
          __dirname,
          "../../plugins/dsh-plugin-pets/src/model.ts",
        ),
        "@amiba/dsh-plugin-pets/pet": resolve(
          __dirname,
          "../../plugins/dsh-plugin-pets/src/client/desktop.tsx",
        ),
        "@amiba/dsh-plugin-notification-hub/model": resolve(
          __dirname,
          "../../plugins/dsh-plugin-notification-hub/src/model.ts",
        ),
        "@amiba/dsh-plugin-notification-hub/client": resolve(
          __dirname,
          "../../plugins/dsh-plugin-notification-hub/src/client/index.tsx",
        ),
        // The pets client reaches the platform singleton via the ui-shell
        // specifier (a plugin build rule); the pet bundle resolves it to a
        // one-line shim instead of pulling the ui-shell plugin.
        "@amiba/dsh-plugin-ui-shell/client": resolve(
          __dirname,
          "src/renderer/pet/ui-shell-client-shim.ts",
        ),
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
          pet: resolve(__dirname, "src/renderer/pet/index.html"),
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
