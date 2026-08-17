import { builtinModules } from "node:module";

import { defineConfig } from "vite";

const externals = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-credentials",
  "@deepseek-ai/dsh-settings",
  "@deepseek-ai/dsh-typert-protocol",
  "@deepseek-ai/schemastery",
  "zod",
]);

/**
 * Host entry is self-contained for the managed runtime. app-runtime exposes
 * TypeScript source to workspace clients, so its harness-independent Model
 * Plane implementation is bundled here instead of leaking source imports into
 * Node's production ESM loader.
 */
export default defineConfig({
  build: {
    outDir: "lib",
    emptyOutDir: false,
    sourcemap: true,
    // Typert Gateway derives remote-method arg descriptors from the method
    // SOURCE (parameter identifiers). Minification renames parameters and
    // silently breaks every @Remote endpoint in this host bundle.
    minify: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: (id) => externals.has(id),
      output: { exports: "named" },
    },
  },
});
