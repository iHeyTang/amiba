import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  // Setting root to src/ui so that Vite mirrors the relative structure from
  // there into outDir, producing dist/ui/sidebar/index.html etc.
  root: resolve(__dirname, "src/ui"),
  // Use relative base so asset references in the built HTML are relative paths
  // (e.g. "../assets/...") rather than absolute ("/assets/..."). Absolute paths
  // break the hermes-ext:// protocol handler which resolves URLs relative to the
  // extension root, not dist/ui/.
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: false, // vite.main.config.ts also writes to dist/
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/ui/main/index.html"),
        settings: resolve(__dirname, "src/ui/settings/index.html"),
      },
    },
  },
})
