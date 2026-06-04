import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  root: resolve(__dirname, "src/ui"),
  // Use relative base so asset references in the built HTML are relative paths
  // (e.g. "../assets/...") rather than absolute ("/assets/..."). Absolute paths
  // break the hermes-ext:// protocol handler which resolves URLs relative to the
  // extension root, not dist/ui/.
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, "src/ui/sidebar/index.html"),
        settings: resolve(__dirname, "src/ui/settings/index.html"),
      },
    },
  },
})
