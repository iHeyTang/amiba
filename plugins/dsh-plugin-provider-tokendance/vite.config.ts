import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "lib",
    emptyOutDir: false,
    minify: false,
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "index.js" },
    rollupOptions: {
      external: (id) =>
        id.startsWith("@amiba/dsh-plugin-media") ||
        id.startsWith("@deepseek-ai/") ||
        id.startsWith("@earendil-works/") ||
        id.startsWith("node:"),
    },
  },
});
