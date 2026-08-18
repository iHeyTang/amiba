import { defineConfig } from "vite";

const PLUGIN_ID = "@amiba/dsh-plugin-catalog";

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
