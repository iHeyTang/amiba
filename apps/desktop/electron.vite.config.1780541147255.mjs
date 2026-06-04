// electron.vite.config.ts
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
var __electron_vite_injected_dirname = "/Users/zhangdehui/Documents/CodeRepo/hermes-x/hermes-x/apps/desktop";
var WORKSPACE_PKGS = [
  "@hermes-x/core",
  "@hermes-x/extension-api",
  "@hermes-x/extension-host",
  "@hermes-x/i18n",
  "@hermes-x/platform",
  "@hermes-x/tailwind-preset",
  "@hermes-x/ui",
  "@hermes-x/utils"
];
var electron_vite_config_default = defineConfig({
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
        "~": resolve(__electron_vite_injected_dirname, "src/renderer")
      }
    },
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html"),
          notifier: resolve(__electron_vite_injected_dirname, "src/renderer/notifier/index.html"),
          "quick-ask": resolve(__electron_vite_injected_dirname, "src/renderer/quick-ask/index.html")
        }
      }
    },
    server: { port: 5173 }
  }
});
export {
  electron_vite_config_default as default
};
