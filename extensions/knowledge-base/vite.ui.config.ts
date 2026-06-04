import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  // Setting root to src/ui so that Vite mirrors the relative structure from
  // there into outDir, producing dist/ui/sidebar/index.html etc.
  root: resolve(__dirname, "src/ui"),
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: false, // vite.main.config.ts also writes to dist/
    sourcemap: true,
    rollupOptions: {
      input: {
        sidebar: resolve(__dirname, "src/ui/sidebar/index.html"),
        settings: resolve(__dirname, "src/ui/settings/index.html"),
        hint: resolve(__dirname, "src/ui/hint/index.html"),
      },
    },
  },
})
