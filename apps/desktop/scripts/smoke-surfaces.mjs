import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createServer } = require("vite");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), "amiba-surfaces-"));
const server = await createServer({
  configFile: false,
  root,
  cacheDir: path.join(profile, "vite-cache"),
  optimizeDeps: {
    entries: ["plugins/dsh-plugin-ui-shell/src/dev/surfaces.html"],
  },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
  resolve: {
    alias: {
      react: path.dirname(require.resolve("react/package.json")),
      "react-dom": path.dirname(require.resolve("react-dom/package.json")),
    },
  },
  esbuild: { jsx: "automatic" },
  css: {
    postcss: {
      plugins: [
        require("tailwindcss")({
          presets: [require("@amiba/ui/tailwind-preset")],
          content: [
            path.join(root, "packages/ui/src/**/*.{ts,tsx}"),
            path.join(root, "plugins/dsh-plugin-ui-shell/src/**/*.{ts,tsx}"),
          ],
        }),
        require("autoprefixer")(),
      ],
    },
  },
});
try {
  await server.listen();
  const address = server.httpServer.address();
  const env = {
    ...process.env,
    AMIBA_SURFACE_URL: `http://127.0.0.1:${address.port}/plugins/dsh-plugin-ui-shell/src/dev/surfaces.html`,
    AMIBA_SURFACE_PROFILE: profile,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [fileURLToPath(new URL("./fixtures/surfaces-smoke.mjs", import.meta.url))],
    { env, stdio: "inherit" },
  );
  const timer = setTimeout(() => child.kill("SIGTERM"), 90000);
  const code = await new Promise((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
  clearTimeout(timer);
  process.exitCode = code;
} finally {
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
