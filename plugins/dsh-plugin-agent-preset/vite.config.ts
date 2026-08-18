import { defineConfig } from "vite";

const PLUGIN_ID = "@amiba/dsh-plugin-agent-preset";

// DSH's Web Shell owns these singleton identities. The emitted client bundle
// resolves them through window.__ModuleLoader__ instead of bundling copies.
const DSH_CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-api-remotes/client",
  "@deepseek-ai/dsh-client-runtime/client",
  "@deepseek-ai/dsh-client-ui-slots",
  "@amiba/dsh-plugin-ui-shell/client",
];

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
      external: DSH_CLIENT_EXTERNALS,
      output: {
        exports: "named",
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
        intro: "var module = { exports: {} }; var exports = module.exports;",
        footer: "return module.exports; } });",
      },
    },
  },
});
