import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/renderer/index.ts"),
      formats: ["es"],
      fileName: () => "renderer.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", /^@hermes-x\//],
    },
  },
})
