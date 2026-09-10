import { defineConfig } from "vite"

const pluginId = "@{{AUTHOR}}/{{NAME}}"
const externals = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-runtime/client",
  "@deepseek-ai/dsh-client-ui-slots",
]

export default defineConfig({
  build: {
    outDir: "lib",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: "src/client/index.tsx",
      formats: ["cjs"],
      fileName: () => "client.js",
    },
    rollupOptions: {
      external: externals,
      output: {
        // DSH registers one factory per entry; relative CJS chunks are not loadable.
        inlineDynamicImports: true,
        exports: "named",
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: (require) => {`,
        intro: "var module = { exports: {} }; var exports = module.exports;",
        footer: "return module.exports; } });",
      },
    },
  },
})
