import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  root: resolve(__dirname, "src/ui"),
  // Use relative base so asset references in the built HTML are relative paths
  // (e.g. "../assets/...") rather than absolute ("/assets/..."). The view HTML is
  // served from the loopback HTTP path /extensions/<id>/<view>/, so absolute
  // ("/assets/...") refs would escape that prefix and 404.
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/ui/main/index.html"),
        settings: resolve(__dirname, "src/ui/settings/index.html"),
      },
    },
  },
})
