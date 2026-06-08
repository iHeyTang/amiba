import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/main/index.ts"),
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    rollupOptions: {
      external: ["electron", /^node:/],
    },
  },
})
