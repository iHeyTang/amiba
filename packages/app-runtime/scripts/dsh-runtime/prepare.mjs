import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const runtimePackageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workspaceDir = path.resolve(runtimePackageDir, "../..");
const bundleNames = [
  "dsh-bundle-amiba-core",
  "dsh-bundle-amiba-web",
  "dsh-bundle-amiba-desktop",
];
const bundleSourceDirs = bundleNames.map((name) =>
  path.join(workspaceDir, "bundles", name),
);
const declaration = JSON.parse(
  await fsp.readFile(
    path.join(runtimePackageDir, "dsh-runtime-manifest.json"),
    "utf8",
  ),
);

/**
 * The workspace catalog, as `name -> concrete version`.
 *
 * The runtime is assembled by writing a package.json and installing it with
 * NPM, which does not understand pnpm's `catalog:` protocol
 * (`EUNSUPPORTEDPROTOCOL`). Plugin manifests are copied into that file
 * verbatim, so every `catalog:` specifier has to be resolved on the way out —
 * the same way `workspace:` specifiers are dropped.
 *
 * Parsed with a regex rather than a YAML dependency: this script has no
 * node_modules of its own, and the catalog block is flat `key: value` pairs.
 */
const catalogVersions = await (async () => {
  const source = await fsp.readFile(
    path.join(workspaceDir, "pnpm-workspace.yaml"),
    "utf8",
  );
  const block = source.match(/^catalog:\n((?:[ \t]+.*\n?)*)/mu);
  if (!block) return new Map();
  const entries = new Map();
  for (const line of block[1].split("\n")) {
    const entry = line.match(/^\s+["']?([^"':]+)["']?:\s*(.+?)\s*$/u);
    if (entry) entries.set(entry[1], entry[2].replace(/^["']|["']$/gu, ""));
  }
  return entries;
})();

/** Replace a `catalog:` specifier with the version the catalog declares. */
function resolveCatalogSpecifier(name, version) {
  if (version !== "catalog:") return version;
  const resolved = catalogVersions.get(name);
  if (!resolved) {
    throw new Error(
      `[dsh:runtime] ${name} uses "catalog:" but pnpm-workspace.yaml declares no catalog entry for it`,
    );
  }
  return resolved;
}
const bundlePackages = await Promise.all(
  bundleSourceDirs.map(async (directory) =>
    JSON.parse(await fsp.readFile(path.join(directory, "package.json"), "utf8")),
  ),
);
const pluginPackageNames = [...new Set(
  bundlePackages.flatMap((manifest) =>
    Object.keys(manifest.dependencies ?? {}).filter((name) =>
      name.startsWith("@amiba/dsh-plugin-"),
    ),
  ),
)].sort();
const pluginNames = pluginPackageNames.map((name) =>
  name.slice("@amiba/".length),
);
const pluginSourceDirs = pluginNames.map((name) =>
  path.join(workspaceDir, "plugins", name),
);
const pluginPackages = await Promise.all(
  pluginSourceDirs.map(async (directory) =>
    JSON.parse(
      await fsp.readFile(path.join(directory, "package.json"), "utf8"),
    ),
  ),
);
const workspacePackages = new Map();
for (const workspaceRoot of ["packages", "plugins", "bundles"]) {
  for (const entry of await fsp.readdir(
    path.join(workspaceDir, workspaceRoot),
    { withFileTypes: true },
  )) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(workspaceDir, workspaceRoot, entry.name);
    const manifestPath = path.join(directory, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    if (typeof manifest.name === "string") {
      workspacePackages.set(manifest.name, { directory, manifest });
    }
  }
}
const outputDir = process.env.DSH_RUNTIME_OUTPUT
  ? path.resolve(process.env.DSH_RUNTIME_OUTPUT)
  : path.join(runtimePackageDir, "resources", "dsh-runtime");
const managedPnpmVersion = "9.12.0";
const markerPath = path.join(outputDir, "runtime-manifest.json");
const args = new Set(process.argv.slice(2));
const verifyOnly = args.has("--verify");
const force = args.has("--force");

async function sourceFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (
        entry.isFile() &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)
      ) {
        files.push(target);
      }
    }
  }
  await visit(root);
  return files;
}

async function computeAmibaSourceDigest() {
  const sourceDirectories = [];
  const visited = new Set();
  const pending = [
    ...bundlePackages.map((manifest) => manifest.name),
    ...pluginPackageNames,
  ];
  while (pending.length > 0) {
    const packageName = pending.shift();
    if (visited.has(packageName)) continue;
    visited.add(packageName);
    const current = workspacePackages.get(packageName);
    if (!current) continue;
    sourceDirectories.push(current.directory);
    const dependencies = {
      ...(current.manifest.dependencies ?? {}),
      ...(current.manifest.optionalDependencies ?? {}),
      ...(current.manifest.peerDependencies ?? {}),
      ...(current.manifest.devDependencies ?? {}),
    };
    for (const dependency of Object.keys(dependencies).sort()) {
      if (dependency.startsWith("@amiba/") && workspacePackages.has(dependency)) {
        pending.push(dependency);
      }
    }
  }

  const files = [];
  for (const directory of sourceDirectories) {
    for (const name of [
      "package.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "vite.config.ts",
      "vite.host.config.ts",
      "tailwind.config.cjs",
      "postcss.config.cjs",
      "cordis.patch.yml",
    ]) {
      const target = path.join(directory, name);
      if (fs.existsSync(target)) files.push(target);
    }
    const sourceDir = path.join(directory, "src");
    if (fs.existsSync(sourceDir)) files.push(...(await sourceFiles(sourceDir)));
  }
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(path.relative(workspaceDir, file));
    hash.update("\0");
    hash.update(await fsp.readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const amibaSourceDigest = await computeAmibaSourceDigest();

/**
 * The exact content of the generated `app/package.json`.
 *
 * This is the complete input to `npm install` (there is no lockfile): it
 * fully encodes the DSH version, the pinned pnpm version, and every
 * third-party dependency name + specifier after `resolveCatalogSpecifier`
 * (a `catalog:` entry resolves to a concrete pinned version; anything else
 * passes through as whatever specifier the plugin declared, semver range
 * included — `npm install` still has to consult the registry to resolve
 * those, same as it always did).
 * Computed once here so the string that gets hashed (`appTreeHash`, below)
 * is byte-identical to the string that later gets written to disk.
 */
const appPackageJsonContent = `${JSON.stringify(
  {
    private: true,
    dependencies: {
      "@deepseek-ai/dsh": declaration.version,
      pnpm: managedPnpmVersion,
      ...Object.fromEntries(
        pluginPackages.flatMap((manifest) =>
          Object.entries(manifest.dependencies ?? {})
            .filter(
              ([name, version]) =>
                !name.startsWith("@amiba/") &&
                typeof version === "string" &&
                !version.startsWith("workspace:"),
            )
            .map(([name, version]) => [
              name,
              resolveCatalogSpecifier(name, version),
            ]),
        ),
      ),
    },
  },
  null,
  2,
)}\n`;
const appTreeHash = createHash("sha256")
  .update(appPackageJsonContent)
  .digest("hex");

function fail(message) {
  throw new Error(`[dsh:runtime] ${message}`);
}

function expectedMarker() {
  return {
    schemaVersion: declaration.bundleSchemaVersion,
    dshVersion: declaration.version,
    nodeVersion: declaration.nodeVersion,
    amibaPluginRevision: declaration.amibaPluginRevision,
    amibaSourceDigest,
    appTreeHash,
    platform: process.platform,
    arch: process.arch,
  };
}

function nodeBinary(root) {
  return process.platform === "win32"
    ? path.join(root, "node", "node.exe")
    : path.join(root, "node", "bin", "node");
}

function npmCli(root) {
  if (process.platform === "win32") {
    return path.join(root, "node", "node_modules", "npm", "bin", "npm-cli.js");
  }
  return path.join(
    root,
    "node",
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
}

function managedNodePath(root) {
  return process.platform === "win32"
    ? path.join(root, "node")
    : path.join(root, "node", "bin");
}

function entrypoint(root) {
  return path.join(
    root,
    "app",
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
}

function amibaPlugin(root, name) {
  return path.join(
    root,
    "app",
    "node_modules",
    "@amiba",
    name,
    "lib",
    "index.js",
  );
}

function amibaPluginClient(root, name) {
  return path.join(
    root,
    "app",
    "node_modules",
    "@amiba",
    name,
    "lib",
    "client.js",
  );
}

function amibaPatch(root, bundleName) {
  return path.join(
    root,
    "app",
    "node_modules",
    "@amiba",
    bundleName,
    "cordis.patch.yml",
  );
}

function pnpmBinary(root) {
  return process.platform === "win32"
    ? path.join(root, "app", "node_modules", ".bin", "pnpm.cmd")
    : path.join(root, "app", "node_modules", ".bin", "pnpm");
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? runtimePackageDir,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture
      ? `\n${result.stdout ?? ""}${result.stderr ?? ""}`
      : "";
    fail(`${command} exited with ${result.status}${detail}`);
  }
  return options.capture ? String(result.stdout).trim() : "";
}

function markerMatches(value) {
  const expected = expectedMarker();
  return Object.entries(expected).every(([key, item]) => value?.[key] === item);
}

function verify(root = outputDir) {
  const markerFile = path.join(root, "runtime-manifest.json");
  if (!fs.existsSync(markerFile)) fail(`missing marker: ${markerFile}`);
  const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  if (!markerMatches(marker)) fail(`stale runtime marker at ${root}`);
  for (const artifact of [
    nodeBinary(root),
    entrypoint(root),
    pnpmBinary(root),
    ...pluginNames.map((name) => amibaPlugin(root, name)),
    ...pluginPackages.flatMap((manifest, index) =>
      manifest.dsh?.client
        ? [amibaPluginClient(root, pluginNames[index])]
        : [],
    ),
    ...bundleNames.map((name) => amibaPatch(root, name)),
    path.join(
      root,
      "app",
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.mjs",
    ),
  ]) {
    if (!fs.existsSync(artifact)) fail(`missing runtime artifact: ${artifact}`);
  }
  const nodeVersion = run(nodeBinary(root), ["--version"], { capture: true });
  if (nodeVersion !== `v${declaration.nodeVersion}`) {
    fail(`expected Node ${declaration.nodeVersion}, got ${nodeVersion}`);
  }
  const dshVersion = run(nodeBinary(root), [entrypoint(root), "-V"], {
    capture: true,
  });
  if (dshVersion !== declaration.version) {
    fail(`expected DSH ${declaration.version}, got ${dshVersion}`);
  }
  const dshManifest = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "app",
        "node_modules",
        "@deepseek-ai",
        "dsh",
        "package.json",
      ),
      "utf8",
    ),
  );
  for (const bundle of bundlePackages) {
    if (dshManifest.dependencies?.[bundle.name] !== bundle.version) {
      fail(`managed DSH installation does not declare ${bundle.name}`);
    }
    const installedBundle = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "app",
          "node_modules",
          "@amiba",
          bundle.name.slice("@amiba/".length),
          "package.json",
        ),
        "utf8",
      ),
    );
    if (installedBundle.dsh?.bundle?.patch !== "./cordis.patch.yml") {
      fail(`${bundle.name} does not declare the official dsh.bundle.patch contract`);
    }
  }
  return marker;
}

if (verifyOnly) {
  const marker = verify();
  console.log(
    `[dsh:runtime] verified DSH ${marker.dshVersion} with Node ${marker.nodeVersion} at ${outputDir}`,
  );
  process.exit(0);
}

if (!force && fs.existsSync(markerPath)) {
  try {
    const marker = verify();
    console.log(
      `[dsh:runtime] already prepared DSH ${marker.dshVersion} at ${outputDir}`,
    );
    process.exit(0);
  } catch {
    // Rebuild stale/incomplete bundles below.
  }
}

function archivePlatform() {
  const arch =
    process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
  if (!arch) fail(`unsupported architecture: ${process.arch}`);
  if (process.platform === "darwin")
    return { platform: "darwin", arch, extension: "tar.xz" };
  if (process.platform === "linux")
    return { platform: "linux", arch, extension: "tar.xz" };
  if (process.platform === "win32" && arch === "x64") {
    return { platform: "win", arch, extension: "zip" };
  }
  fail(`unsupported runtime target: ${process.platform}-${process.arch}`);
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) fail(`download failed (${response.status}): ${url}`);
  await fsp.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function normalizeManagedNodeLinks(root) {
  if (process.platform === "win32") return;
  const binDir = path.join(root, "node", "bin");
  for (const [name, target] of [
    ["corepack", "../lib/node_modules/corepack/dist/corepack.js"],
    ["npm", "../lib/node_modules/npm/bin/npm-cli.js"],
    ["npx", "../lib/node_modules/npm/bin/npx-cli.js"],
  ]) {
    const link = path.join(binDir, name);
    await fsp.rm(link, { force: true });
    await fsp.symlink(target, link);
  }
}

async function installNode(stage) {
  const installedMarkerPath = path.join(outputDir, "runtime-manifest.json");
  const installedNode = nodeBinary(outputDir);
  if (fs.existsSync(installedMarkerPath) && fs.existsSync(installedNode)) {
    try {
      const installedMarker = JSON.parse(
        await fsp.readFile(installedMarkerPath, "utf8"),
      );
      const reusable =
        installedMarker.nodeVersion === declaration.nodeVersion &&
        installedMarker.platform === process.platform &&
        installedMarker.arch === process.arch &&
        run(installedNode, ["--version"], { capture: true }) ===
          `v${declaration.nodeVersion}`;
      if (reusable) {
        await fsp.cp(path.join(outputDir, "node"), path.join(stage, "node"), {
          recursive: true,
        });
        await normalizeManagedNodeLinks(stage);
        console.log(
          `[dsh:runtime] reused managed Node ${declaration.nodeVersion} from the existing runtime`,
        );
        return (
          installedMarker.nodeSource ??
          `managed-runtime:${declaration.nodeVersion}-${process.platform}-${process.arch}`
        );
      }
    } catch (error) {
      console.warn(
        `[dsh:runtime] existing managed Node is not reusable: ${error instanceof Error ? error.message : String(error)}`,
      );
      await fsp.rm(path.join(stage, "node"), {
        recursive: true,
        force: true,
      });
    }
  }

  const target = archivePlatform();
  const baseName = `node-v${declaration.nodeVersion}-${target.platform}-${target.arch}`;
  const archiveName = `${baseName}.${target.extension}`;
  const baseUrl = `https://nodejs.org/dist/v${declaration.nodeVersion}`;
  const archive = path.join(stage, archiveName);
  const sums = path.join(stage, "SHASUMS256.txt");
  await Promise.all([
    download(`${baseUrl}/${archiveName}`, archive),
    download(`${baseUrl}/SHASUMS256.txt`, sums),
  ]);
  const expected = fs
    .readFileSync(sums, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .find(([, name]) => name === archiveName)?.[0];
  if (!expected) fail(`Node checksum is absent for ${archiveName}`);
  const actual = createHash("sha256")
    .update(fs.readFileSync(archive))
    .digest("hex");
  if (actual !== expected) fail(`Node checksum mismatch for ${archiveName}`);
  const nodeDir = path.join(stage, "node");
  await fsp.mkdir(nodeDir, { recursive: true });
  run("tar", ["-xf", archive, "--strip-components=1", "-C", nodeDir]);
  await normalizeManagedNodeLinks(stage);
  return `${baseUrl}/${archiveName}`;
}

/**
 * Reuse the app dependency tree (`app/node_modules`) from the existing
 * runtime at `outputDir` when its marker declares the same `appTreeHash` —
 * i.e. the generated `app/package.json` (the complete `npm install` input,
 * since there is no lockfile) is byte-identical to the previous build's.
 *
 * `appTreeHash` alone only covers dependency name + specifier; it says
 * nothing about the platform/arch/Node version the tree was actually
 * resolved and built under. `npm install` runs with `--ignore-scripts=false`,
 * so some of these packages compile native addons at install time — a tree
 * built on one platform/arch (or against a different managed Node) is not
 * safe to copy into a build for another. `outputDir` can also be a shared or
 * persisted location via `DSH_RUNTIME_OUTPUT`, which makes cross-platform
 * reuse plausible in practice, not just theoretical. So this also gates on
 * `nodeVersion`/`platform`/`arch` matching the current run, mirroring the
 * same three checks `installNode` already uses to decide whether the
 * managed Node itself is reusable.
 *
 * Conservative by design: a missing marker, a missing `app/node_modules`, a
 * hash/platform/arch/Node-version mismatch, an unreadable/corrupt marker, or
 * a failed copy all fall back to `false` (full install below) rather than
 * risking a stale or cross-platform reuse. An old marker without
 * `appTreeHash` compares as `undefined !== <hash>` and also falls back to a
 * full install.
 */
async function reuseAppDependencyTree(appDir) {
  const installedMarkerPath = path.join(outputDir, "runtime-manifest.json");
  const installedNodeModules = path.join(outputDir, "app", "node_modules");
  if (
    !fs.existsSync(installedMarkerPath) ||
    !fs.existsSync(installedNodeModules)
  ) {
    return false;
  }
  try {
    const installedMarker = JSON.parse(
      await fsp.readFile(installedMarkerPath, "utf8"),
    );
    const reusable =
      installedMarker.appTreeHash === appTreeHash &&
      installedMarker.nodeVersion === declaration.nodeVersion &&
      installedMarker.platform === process.platform &&
      installedMarker.arch === process.arch;
    if (!reusable) return false;
    await fsp.cp(installedNodeModules, path.join(appDir, "node_modules"), {
      recursive: true,
    });
    console.log(
      "[dsh:runtime] reused app dependency tree from the existing runtime (manifest unchanged)",
    );
    return true;
  } catch (error) {
    console.warn(
      `[dsh:runtime] existing app dependency tree is not reusable: ${error instanceof Error ? error.message : String(error)}`,
    );
    await fsp.rm(path.join(appDir, "node_modules"), {
      recursive: true,
      force: true,
    });
    return false;
  }
}

const stage = await fsp.mkdtemp(
  path.join(runtimePackageDir, ".dsh-runtime-build-"),
);
try {
  for (const pluginSourceDir of pluginSourceDirs) {
    run("pnpm", ["--dir", pluginSourceDir, "build"]);
  }
  const nodeSource = await installNode(stage);
  const appDir = path.join(stage, "app");
  await fsp.mkdir(appDir, { recursive: true });
  await fsp.writeFile(path.join(appDir, "package.json"), appPackageJsonContent);
  const reusedAppTree = await reuseAppDependencyTree(appDir);
  if (!reusedAppTree) {
    run(
      nodeBinary(stage),
      [
        npmCli(stage),
        "install",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--ignore-scripts=false",
        "--prefer-offline",
      ],
      {
        cwd: appDir,
        env: {
          ...process.env,
          PATH: `${managedNodePath(stage)}${path.delimiter}${process.env.PATH ?? ""}`,
          npm_config_cache: path.join(
            runtimePackageDir,
            ".cache",
            "dsh-runtime",
            "npm",
          ),
        },
      },
    );
  }
  const amibaScope = path.join(appDir, "node_modules", "@amiba");
  await fsp.mkdir(amibaScope, { recursive: true });
  for (const [index, pluginSourceDir] of pluginSourceDirs.entries()) {
    const pluginDestination = path.join(amibaScope, pluginNames[index]);
    await fsp.mkdir(pluginDestination, { recursive: true });
    // On a reused app tree, `pluginDestination/lib` may already exist from
    // the previous build. `fsp.cp` merges into an existing directory rather
    // than replacing it, so without this the copy below would leave a
    // renamed/removed compiled file behind as a stale orphan. Clear it
    // first so every build lands a clean replace, cache hit or not.
    await fsp.rm(path.join(pluginDestination, "lib"), {
      recursive: true,
      force: true,
    });
    await Promise.all([
      fsp.cp(
        path.join(pluginSourceDir, "lib"),
        path.join(pluginDestination, "lib"),
        {
          recursive: true,
        },
      ),
      fsp.copyFile(
        path.join(pluginSourceDir, "package.json"),
        path.join(pluginDestination, "package.json"),
      ),
    ]);
  }
  for (const [index, bundleSourceDir] of bundleSourceDirs.entries()) {
    const bundleDestination = path.join(amibaScope, bundleNames[index]);
    await fsp.mkdir(bundleDestination, { recursive: true });
    await Promise.all([
      fsp.copyFile(
        path.join(bundleSourceDir, "package.json"),
        path.join(bundleDestination, "package.json"),
      ),
      fsp.copyFile(
        path.join(bundleSourceDir, "cordis.patch.yml"),
        path.join(bundleDestination, "cordis.patch.yml"),
      ),
    ]);
  }
  const dshManifestPath = path.join(
    appDir,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "package.json",
  );
  const dshManifest = JSON.parse(await fsp.readFile(dshManifestPath, "utf8"));
  dshManifest.dependencies ??= {};
  for (const bundle of bundlePackages) {
    dshManifest.dependencies[bundle.name] = bundle.version;
  }
  await fsp.writeFile(
    dshManifestPath,
    `${JSON.stringify(dshManifest, null, 2)}\n`,
  );
  const marker = {
    ...expectedMarker(),
    nodeSource,
    builtAt: new Date().toISOString(),
  };
  await fsp.writeFile(
    path.join(stage, "runtime-manifest.json"),
    `${JSON.stringify(marker, null, 2)}\n`,
  );
  verify(stage);
  await fsp.mkdir(path.dirname(outputDir), { recursive: true });
  await fsp.rm(outputDir, { recursive: true, force: true });
  await fsp.rename(stage, outputDir);
  console.log(
    `[dsh:runtime] prepared DSH ${declaration.version} with Node ${declaration.nodeVersion} at ${outputDir}`,
  );
} catch (error) {
  await fsp.rm(stage, { recursive: true, force: true });
  throw error;
}
