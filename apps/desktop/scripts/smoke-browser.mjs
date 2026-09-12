import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../..", import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), "amiba-browser-smoke-"));
const output = path.join(root, "apps/desktop/out/browser-smoke");
await mkdir(output, { recursive: true });
try {
  await createRequire(require.resolve("vite"))("esbuild").build({
    entryPoints: [
      path.join(root, "apps/desktop/src/main/desktop-extensions.ts"),
    ],
    outfile: path.join(work, "host.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  await createRequire(require.resolve("vite"))("esbuild").build({
    stdin: {
      contents: `export { DshRuntimeController, managedDshPaths } from "./apps/desktop/src/main/dsh-runtime.ts"; export { startDshNativeGateway } from "./apps/desktop/src/main/dsh-native-gateway.ts";`,
      resolveDir: root,
    },
    outfile: path.join(work, "runtime.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
  });
  const plugin = path.join(
    root,
    "plugins/dsh-plugin-browser-provider-electron",
  );
  const packed = spawnSync("pnpm", ["pack", "--pack-destination", work], {
    cwd: plugin,
    encoding: "utf8",
  });
  if (packed.status !== 0) throw new Error(packed.stdout + packed.stderr);
  const archive = path.join(
    work,
    "amiba-dsh-plugin-browser-provider-electron-0.1.0.tgz",
  );
  const installed = path.join(
    work,
    "node_modules/@amiba/dsh-plugin-browser-provider-electron",
  );
  await mkdir(installed, { recursive: true });
  const extracted = spawnSync("tar", [
    "-xzf",
    archive,
    "--strip-components=1",
    "-C",
    installed,
  ]);
  if (extracted.status !== 0) throw new Error("Cannot extract browser archive");
  const manifest = JSON.parse(
    await readFile(path.join(installed, "package.json"), "utf8"),
  );
  if (
    !manifest.dsh?.native ||
    !manifest.dsh?.bundle?.patch ||
    !manifest.dsh?.client
  )
    throw new Error("Incomplete browser package");
  await writeFile(
    path.join(work, "package.json"),
    JSON.stringify({ dependencies: { [manifest.name]: "file:" + archive } }),
  );
  const child = spawn(
    require("electron"),
    [path.join(root, "apps/desktop/scripts/fixtures/browser-smoke.mjs")],
    {
      env: {
        ...process.env,
        AMIBA_BROWSER_SMOKE_ROOT: work,
        AMIBA_BROWSER_SMOKE_OUTPUT: output,
        AMIBA_DSH_RUNTIME_DIR: path.join(
          root,
          "packages/app-runtime/resources/dsh-runtime",
        ),
        ELECTRON_RUN_AS_NODE: "",
      },
      stdio: "inherit",
    },
  );
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (result !== 0) throw new Error(`Browser smoke exited ${result}`);
  console.log(
    `Browser package + Electron lifecycle verified. Evidence: ${output}`,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
