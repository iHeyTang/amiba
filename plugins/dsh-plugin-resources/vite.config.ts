import { defineConfig } from "vite";
export default defineConfig({
  build: {
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
        banner:
          'window.__ModuleLoader__.load({ id: "@amiba/dsh-plugin-resources", factory: (require) => {',
        intro: "var module = { exports: {} }; var exports = module.exports;",
        footer: "return module.exports; } });",
      },
    },
  },
});
