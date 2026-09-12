import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "node22",
    outDir: "lib",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: "src/native/index.ts",
      formats: ["cjs"],
      fileName: () => "native.cjs",
    },
    rollupOptions: {
      external: (id) => id === "electron" || id.startsWith("node:"),
      output: { inlineDynamicImports: true },
    },
  },
});
