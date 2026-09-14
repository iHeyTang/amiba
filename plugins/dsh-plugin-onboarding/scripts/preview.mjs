import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const shellRequire = createRequire(
  path.join(root, "plugins/dsh-plugin-ui-shell/package.json"),
);
const tailwind = shellRequire("tailwindcss");
const preset = shellRequire("@amiba/ui/tailwind-preset");
const server = await createServer({
  root,
  configFile: false,
  css: {
    postcss: {
      plugins: [
        tailwind({
          presets: [preset],
          content: [
            path.join(root, "plugins/dsh-plugin-*/src/**/*.{ts,tsx}"),
            path.join(root, "packages/ui/src/**/*.{ts,tsx}"),
          ],
        }),
        shellRequire("autoprefixer")(),
      ],
    },
  },
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
console.log(
  "http://127.0.0.1:5198/plugins/dsh-plugin-onboarding/src/dev/index.html",
);
