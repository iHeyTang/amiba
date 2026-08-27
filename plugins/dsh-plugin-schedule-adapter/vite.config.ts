import { defineConfig } from "vite";

const PLUGIN_ID = "@amiba/dsh-plugin-schedule-adapter";

export default defineConfig({
  build: {
    // Match the TypeScript target. Vite's default ("modules") includes
    // safari14, which makes esbuild lower optional chaining — and that lowering
    // is wrong inside a default parameter (see dsh-plugin-ui-shell).
    target: "es2022",
    outDir: "lib",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: "src/client/index.tsx",
      formats: ["cjs"],
      fileName: () => "client.js",
    },
    rollupOptions: {
      external: [
        "react",
        "react/jsx-runtime",
        "react-dom",
        "react-dom/client",
        "@deepseek-ai/cordis",
        "@deepseek-ai/dsh-api-remotes/client",
        "@deepseek-ai/dsh-client-runtime/client",
        "@deepseek-ai/dsh-client-ui-slots",
        "@amiba/dsh-plugin-ui-shell/client",
      ],
      output: {
        exports: "named",
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
        intro: "var module = { exports: {} }; var exports = module.exports;",
        footer: "return module.exports; } });",
      },
    },
  },
});
