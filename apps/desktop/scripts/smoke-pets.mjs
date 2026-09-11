import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createServer } = require("vite");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const { PetService } = await import(
  "../../../plugins/dsh-plugin-pets/lib/service.js"
);
const { StudioHost } = await import(
  "../../../plugins/dsh-plugin-pets/lib/studio.js"
);
const studio = new StudioHost();
const profile = await mkdtemp(path.join(tmpdir(), "amiba-surfaces-"));
const pets = new PetService(profile);
const server = await createServer({
  configFile: false,
  plugins: [
    {
      name: "pets-fixture",
      configureServer(server) {
        server.middlewares.use("/__pets", async (req, res) => {
          let raw = "";
          for await (const chunk of req) raw += chunk;
          try {
            const method = req.url.slice(1);
            const args = JSON.parse(raw);
            const value =
              method === "studio"
                ? await studio.open()
                : await pets[method === "deletePet" ? "remove" : method](...args);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, value }));
          } catch (e) {
            res.end(
              JSON.stringify({ ok: false, error: { message: e.message } }),
            );
          }
        });
      },
    },
  ],
  root,
  cacheDir: path.join(profile, "vite-cache"),
  optimizeDeps: {
    entries: ["plugins/dsh-plugin-pets/src/dev/pets.html"],
  },
  server: { hmr: false, host: "127.0.0.1", port: 0, fs: { allow: [root] } },
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
            path.join(root, "plugins/dsh-plugin-pets/src/**/*.{ts,tsx}"),
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
    AMIBA_SURFACE_URL: `http://127.0.0.1:${address.port}/plugins/dsh-plugin-pets/src/dev/pets.html`,
    AMIBA_SURFACE_PROFILE: profile,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [fileURLToPath(new URL("./fixtures/pets-smoke.mjs", import.meta.url))],
    { env, stdio: "inherit" },
  );
  const timer = setTimeout(() => child.kill("SIGTERM"), 90000);
  const code = await new Promise((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
  clearTimeout(timer);
  process.exitCode = code;
} finally {
  studio.dispose();
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
