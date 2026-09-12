import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureManagedDshProfile,
  resolveManagedDshRuntimePaths,
} from "../../../packages/app-runtime/dist/dsh-runtime/index.js";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../..", import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), "amiba-browser-profile-"));
try {
  await createRequire(require.resolve("vite"))("esbuild").build({
    entryPoints: [
      path.join(root, "apps/desktop/src/main/dsh-profile-plugins.ts"),
    ],
    outfile: path.join(work, "manager.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  const { DshProfilePluginManager, runManagedDshPluginCommand } = require(
    path.join(work, "manager.cjs"),
  );
  const paths = resolveManagedDshRuntimePaths({
    surface: "desktop",
    home: path.join(work, "home"),
    runtimeDir: path.join(root, "packages/app-runtime/resources/dsh-runtime"),
  });
  process.env.AMIBA_RUNTIME_GATEWAY_URL = "http://127.0.0.1:1";
  process.env.AMIBA_RUNTIME_GATEWAY_TOKEN =
    "browser-profile-smoke-token-with-32-characters";
  const compose = () =>
    runManagedDshPluginCommand(
      ["--profile", paths.profileName, "--dump-config"],
      paths,
    );
  const runtime = {
    ensureManagedProfile: () => ensureManagedDshProfile(paths),
    stop: async () => {},
    ensureStarted: compose,
  };
  const manager = new DshProfilePluginManager({ paths, runtime });
  const browser = "@amiba/dsh-plugin-browser-provider-electron";
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  await runtime.ensureManagedProfile();
  console.log("Composing migrated desktop profile");
  const initial = await compose();
  assert(
    initial.stdout.includes("amiba-browser-provider-electron"),
    "Default browser not composed",
  );
  console.log("Removing browser through DSH plugin manager");
  await manager.remove(browser);
  const removed = await compose();
  assert(
    !removed.stdout.includes("amiba-browser-provider-electron"),
    "Removed browser still composed",
  );
  const pack = spawnSync("pnpm", ["pack", "--pack-destination", work], {
    cwd: path.join(root, "plugins/dsh-plugin-browser-provider-electron"),
    encoding: "utf8",
  });
  if (pack.status !== 0) throw new Error(pack.stdout + pack.stderr);
  const archive = path.join(
    work,
    "amiba-dsh-plugin-browser-provider-electron-0.1.0.tgz",
  );
  console.log("Installing browser archive through DSH plugin manager");
  await manager.installArchive(archive);
  const installed = await compose();
  assert(
    installed.stdout.includes("amiba-browser-provider-electron"),
    "Installed browser not composed",
  );
  const staging = path.join(work, "replacement");
  await mkdir(staging);
  if (spawnSync("tar", ["-xzf", archive, "-C", staging]).status !== 0)
    throw new Error("Cannot unpack replacement");
  const filename = path.join(staging, "package/package.json");
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  manifest.version = "0.1.1";
  await writeFile(filename, JSON.stringify(manifest, null, 2));
  const replacement = path.join(work, "replacement.tgz");
  if (
    spawnSync("tar", ["-czf", replacement, "-C", staging, "package"]).status !==
    0
  )
    throw new Error("Cannot pack replacement");
  console.log("Replacing installed browser archive");
  await manager.installArchive(replacement);
  const inventory = await manager.list();
  assert(
    inventory.packages.find((entry) => entry.packageName === browser)
      ?.version === "0.1.1",
    "Replacement version not installed",
  );
  await manager.remove(browser);
  await runtime.ensureManagedProfile();
  const final = JSON.parse(await readFile(paths.profileManifest, "utf8"));
  assert(
    !(browser in final.dependencies),
    "Restart reinstalls removed browser",
  );
  const output = path.join(root, "apps/desktop/out/browser-smoke");
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "profile-result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "migration composes browser",
          "official CLI removal",
          "archive install",
          "replacement archive version",
          "second removal",
          "restart preserves removal",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Browser profile smoke: 6 checks passed");
} finally {
  await rm(work, { recursive: true, force: true });
}
