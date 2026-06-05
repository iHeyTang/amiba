import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "src/ui"),
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/ui/main/index.html"),
      },
    },
  },
})
