import { readFileSync } from "node:fs";
import { clientInputs } from "../../scripts/dsh-client-inputs.mjs";
import { defineConfig } from "vite";
import { officialClientCore } from "../../scripts/official-client-core";
import { pdfBuildData } from './scripts/pdf-assets';
const pdf = pdfBuildData();

const DEEPSEEK_LICENSE = readFileSync(new URL("./LICENSE.deepseek", import.meta.url), "utf8");

const PLUGIN_ID = "@amiba/dsh-plugin-ui-shell";

// DSH's Web Shell owns these singleton identities. The emitted client bundle
// resolves them through window.__ModuleLoader__ instead of bundling copies.
const DSH_CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-web-react",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-attachment",
  "@deepseek-ai/dsh-client-schema-form",
  "@deepseek-ai/dsh-client-store",
];

export default defineConfig({
  define: { __DSH_PDFJS_ASSETS__: pdf.assets },
  plugins: [officialClientCore(import.meta.url, {
    "@deepseek-ai/dsh-client-ui-conversation/client": ["UiConversation", "ConversationController"],
    "@deepseek-ai/dsh-client-ui-chat/client": ["EMPTY_CHAT_SNAPSHOT", "registerConversationNodes"],
  }), clientInputs()],
  build: {
    // Match the TypeScript target. Vite's default ("modules") includes
    // safari14, which makes esbuild LOWER optional chaining — and its
    // lowering is wrong inside a default parameter, where it cannot hoist a
    // `var` temporary and resorts to IIFEs whose scopes it then gets wrong:
    // `a?.b?.()` emitted `(r => ... r.call(e))()` with `e` declared in an
    // inner arrow, throwing `ReferenceError: e is not defined` at runtime.
    // ES2022 has optional chaining natively, so nothing is lowered.
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
      external: DSH_CLIENT_EXTERNALS,
      output: {
        inlineDynamicImports: true,
        exports: "named",
        banner: `/*!\n${DEEPSEEK_LICENSE}\n*/\n${pdf.banner}\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
        intro: "var module = { exports: {} }; var exports = module.exports;",
        footer: "return module.exports; } });",
      },
    },
  },
});
