import { patchSetDigest, canReusePatchSet } from "./reuse-dependencies.mjs";
import { packageCommand, applyManagedRuntimePatches, pruneRuntime, runtimePatchTargets } from "./process-tools.mjs";
import { validateDependencyLock, validatePluginBuildSources } from "./dependency-lock.mjs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { pluginInstallManifest, checkHostContract, isolatePluginDependencies, distributionHashes } from "./plugin-distribution.mjs";

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
  const block = source.replace(/\r\n/gu, "\n").match(/^catalog:\n((?:[ \t]+.*\n?)*)/mu);
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
// Build order is DEPENDENCY order, not alphabetical: a plugin that imports
// another plugin's type surface (e.g. `@amiba/dsh-plugin-ui-shell/client`'s
// Context augmentation) type-checks against that plugin's built `lib/`, so
// the dependency must be rebuilt first or the dependent's `tsc` sees a stale
// declaration. Only the build loop uses this order; every other array above
// stays alphabetical so manifests and hashes are unaffected.
const pluginBuildOrder = (() => {
  const manifestByName = new Map(
    pluginPackages.map((manifest, index) => [manifest.name, index]),
  );
  const ordered = [];
  const visiting = new Set();
  const visit = (name) => {
    if (ordered.includes(name)) return;
    if (visiting.has(name)) {
      throw new Error(
        `[dsh:runtime] circular @amiba/dsh-plugin-* dependency at ${name}`,
      );
    }
    visiting.add(name);
    const manifest = pluginPackages[manifestByName.get(name)];
    const pluginDependencies = Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
      // Type-only service augmentations are often development dependencies
      // (notably the optional Electron browser's runtime gateway).
      ...(manifest.devDependencies ?? {}),
    })
      .filter((dependency) => manifestByName.has(dependency))
      .sort();
    for (const dependency of pluginDependencies) visit(dependency);
    visiting.delete(name);
    ordered.push(name);
  };
  for (const name of pluginPackageNames) visit(name);
  return ordered.map((name) => pluginSourceDirs[manifestByName.get(name)]);
})();
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
const lockTarget = [...args].find(arg => arg.startsWith('--lock-target='))?.slice('--lock-target='.length);
if (lockTarget && (!(args.has('--update-lock') || args.has('--validate-only')) || lockTarget !== 'darwin-x64')) throw new Error('--lock-target=darwin-x64 requires --update-lock or --validate-only');
const dependencyTarget = lockTarget || `${process.platform}-${process.arch}`;
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
        !/\.(?:test|spec|generated)\.[cm]?[jt]sx?$/u.test(entry.name)
      ) {
        files.push(target);
      }
    }
  }
  await visit(root);
  return files;
}

const pluginSkillAssets = await Promise.all(pluginSourceDirs.map((directory, index) =>
  pluginPackages[index].files?.includes("skills") ? sourceFiles(path.join(directory, "skills")) : [],
));
const licenseName = /^(?:LICENSE|NOTICE)(?:[.-][A-Za-z0-9_.-]+)?$/u;
const pluginLicenseAssets = pluginSourceDirs.map((directory, index) =>
  (pluginPackages[index].files ?? []).filter(name => licenseName.test(name)).map(name => path.join(directory, name)),
);

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
      "vite.native.config.ts",
      "tailwind.config.cjs",
      "tailwind-preset.cjs",
      "postcss.config.cjs",
      "cordis.patch.yml",
    ]) {
      const target = path.join(directory, name);
      if (fs.existsSync(target)) files.push(target);
    }
    const scriptsDir = path.join(directory, "scripts");
    if (fs.existsSync(scriptsDir)) files.push(...(await sourceFiles(scriptsDir)));
    const sourceDir = path.join(directory, "src");
    if (fs.existsSync(sourceDir)) files.push(...(await sourceFiles(sourceDir)));
    const skillsDir = path.join(directory, "skills");
    if (fs.existsSync(skillsDir)) files.push(...(await sourceFiles(skillsDir)));
  }
  const patchesDir = path.join(workspaceDir, "patches");
  files.push(...pluginLicenseAssets.flat());
  if (fs.existsSync(patchesDir)) files.push(...(await sourceFiles(patchesDir)));
  files.push(path.join(workspaceDir, "package.json"));
  files.push(path.join(workspaceDir, "scripts/dsh-client-inputs.mjs"));
  for (const name of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.dsh-plugin.json"]) {
    files.push(path.join(workspaceDir, name));
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

await validatePluginBuildSources(workspaceDir, pluginPackages.map((manifest, index) => ({ manifest, directory: pluginSourceDirs[index] })));
const amibaSourceDigest = await computeAmibaSourceDigest();

/** Host dependencies are explicit; business dependencies belong to plugin locks. */
const hostManifest = JSON.parse(await fsp.readFile(path.join(runtimePackageDir, 'host-dependencies.json'), 'utf8'));
const appPackageJsonContent = `${JSON.stringify(hostManifest, null, 2)}\n`;
const pluginInstalls = pluginPackages.map((manifest, index) => ({
  manifest: pluginInstallManifest(manifest, hostManifest, resolveCatalogSpecifier, dependencyTarget),
  directory: path.join(pluginSourceDirs[index], 'distribution', manifest.amiba?.distribution?.targets?.[dependencyTarget] ? dependencyTarget : 'default'),
}));
const dependencyDir = path.join(runtimePackageDir, "runtime-deps");
const dependencyManifest = path.join(dependencyDir, "package.json");
const dependencyLock = path.join(dependencyDir, "package-lock.json");
if (args.has("--update-lock")) {
  const selected = [...args].find(arg => arg.startsWith('--plugin='))?.slice('--plugin='.length);
  const entries = selected ? pluginInstalls.filter(entry => entry.manifest.name === selected || entry.manifest.name === `@amiba/${selected}`) : [{ directory: dependencyDir, manifest: hostManifest }, ...pluginInstalls];
  if (!entries.length) throw new Error(`Unknown plugin: ${selected}`);
  for (const entry of entries) {
    await fsp.mkdir(entry.directory, { recursive: true });
    await fsp.writeFile(path.join(entry.directory, 'package.json'), `${JSON.stringify(entry.manifest, null, 2)}\n`);
    const npmArgs = ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online'];
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, { cwd: entry.directory });
  }
  console.log('[dsh:runtime] updated host and plugin locks; commit the changed distribution files');
  process.exit(0);
}

const dependencyLockContent = await fsp.readFile(dependencyLock, "utf8");
validateDependencyLock(JSON.parse(appPackageJsonContent), JSON.parse(await fsp.readFile(dependencyManifest, "utf8")), JSON.parse(dependencyLockContent));
const workspaceManifest = JSON.parse(await fsp.readFile(path.join(workspaceDir, "package.json"), "utf8"));
const reviewedPatches = { ...workspaceManifest.pnpm?.patchedDependencies, ...workspaceManifest.amiba?.runtimePatches };
const patchSetHash = await patchSetDigest(reviewedPatches, file => fsp.readFile(path.resolve(workspaceDir, file), "utf8"));
const hostLock = JSON.parse(dependencyLockContent);
const pluginLockContents = await Promise.all(pluginInstalls.map(async entry => {
  checkHostContract(entry.manifest, hostLock);
  const content = await fsp.readFile(path.join(entry.directory, 'package-lock.json'), 'utf8');
  validateDependencyLock(entry.manifest, JSON.parse(await fsp.readFile(path.join(entry.directory, 'package.json'), 'utf8')), JSON.parse(content));
  return content;
}));
if (args.has('--validate-only')) {
  console.log(`Validated distributable plugin sources and runtime lock for ${dependencyTarget}`);
  process.exit(0);
}
const { dependencyLockHash, appTreeHash } = distributionHashes(appPackageJsonContent, dependencyLockContent, pluginLockContents, pluginPackages.map(plugin => plugin.amiba?.distribution ?? {}));

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
    dependencyInstallMode: "isolated-plugins-v2",
    appTreeHash,
    dependencyLockHash,
    patchSetHash,
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
  const [executable, argv] = packageCommand(command, commandArgs);
  const result = spawnSync(executable, argv, {
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
    ...pluginSkillAssets.flatMap((files, index) => files.map(file =>
      path.join(root, "app/node_modules/@amiba", pluginNames[index], path.relative(pluginSourceDirs[index], file)),
    )),
    ...pluginLicenseAssets.flatMap((files, index) => files.map(file =>
      path.join(root, "app/node_modules/@amiba", pluginNames[index], path.basename(file)),
    )),
    ...pluginPackages.flatMap((manifest, index) =>
      manifest.dsh?.client
        ? [amibaPluginClient(root, pluginNames[index])]
        : [],
    ),
    ...pluginPackages.flatMap((manifest, index) => [manifest.dsh?.native, manifest.dsh?.bundle?.patch]
      .filter(Boolean).map(entry => path.join(root, "app/node_modules/@amiba", pluginNames[index], entry))),
    ...bundleNames.map((name) => amibaPatch(root, name)),
    ...pluginPackages.flatMap((manifest, index) => (manifest.amiba?.distribution?.requiredFiles ?? []).map(file =>
      path.join(root, 'app/node_modules/@amiba', pluginNames[index], file))),
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
  // The downloaded archive and checksum file are staging-only: they were
  // previously shipped inside the runtime (~25 MB/target) because nothing
  // ever removed them.
  await fsp.rm(archive, { force: true });
  await fsp.rm(sums, { force: true });
  return `${baseUrl}/${archiveName}`;
}

/**
 * Reuse the app dependency tree (`app/node_modules`) from the existing
 * runtime at `outputDir` when its marker declares the same `appTreeHash` —
 * i.e. the generated manifest and committed npm lock are byte-identical
 * to the previous build's.
 *
 * `appTreeHash` covers the resolved dependency tree; it says
 * nothing about the platform/arch/Node version the tree was actually
 * resolved and built under. `npm ci` runs with `--ignore-scripts=false`,
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
 * Changed/removed dependency versions or a platform/arch/Node-version mismatch,
 * an unreadable/corrupt marker, or
 * a failed copy all fall back to `false` (full install below) rather than
 * risking a stale or cross-platform reuse. Exact additions already present at
 * the root of the verified tree may be promoted only with an unchanged lock. An old marker without
 * `appTreeHash` compares as `undefined !== <hash>` and also falls back to a
 * full install.
 */
async function reuseAppDependencyTree(appDir) {
  if (force) return false;
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
    // Only reuse trees created by the registry-only installer, never earlier injected trees.
    if (installedMarker.dependencyInstallMode !== "isolated-plugins-v2") return false;
    if (!canReusePatchSet(installedMarker, patchSetHash)) return false;
    const sameDependencies = installedMarker.appTreeHash === appTreeHash;
    const reusable =
      sameDependencies && installedMarker.dependencyLockHash === dependencyLockHash &&
      installedMarker.nodeVersion === declaration.nodeVersion &&
      installedMarker.platform === process.platform &&
      installedMarker.arch === process.arch;
    if (!reusable) return false;
    await fsp.cp(installedNodeModules, path.join(appDir, "node_modules"), {
      recursive: true,
    });
    console.log(
      "[dsh:runtime] reused verified app dependency tree (unchanged versions; any new direct dependencies already installed)",
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
  for (const pluginSourceDir of pluginBuildOrder) {
    run("pnpm", ["--dir", pluginSourceDir, "build"]);
  }
  const nodeSource = await installNode(stage);
  const appDir = path.join(stage, "app");
  await fsp.mkdir(appDir, { recursive: true });
  await fsp.writeFile(path.join(appDir, "package.json"), appPackageJsonContent);
  await fsp.writeFile(path.join(appDir, "package-lock.json"), dependencyLockContent);
  const reusedAppTree = await reuseAppDependencyTree(appDir);
  if (!reusedAppTree) {
    console.log("[dsh:runtime] installing locked npm dependencies (npm ci)");
    run(
      nodeBinary(stage),
      [
        npmCli(stage),
        "ci",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts=false",
        "--prefer-offline",
        "--loglevel=info",
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
  applyManagedRuntimePatches(appDir, workspaceDir);
  const amibaScope = path.join(appDir, "node_modules", "@amiba");
  await fsp.mkdir(amibaScope, { recursive: true });
  for (const [index, pluginSourceDir] of pluginSourceDirs.entries()) {
    const pluginDestination = path.join(amibaScope, pluginNames[index]);
    await fsp.mkdir(pluginDestination, { recursive: true });
    // Each plugin owns its dependency graph, lock and installation directory.
    if (!reusedAppTree) {
      const install = pluginInstalls[index];
      await fsp.writeFile(path.join(pluginDestination, 'package.json'), `${JSON.stringify(install.manifest, null, 2)}\n`);
      await fsp.writeFile(path.join(pluginDestination, 'package-lock.json'), pluginLockContents[index]);
      run(nodeBinary(stage), [npmCli(stage), 'ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts=false', '--prefer-offline'], {
        cwd: pluginDestination,
        env: { ...process.env, PATH: `${managedNodePath(stage)}${path.delimiter}${process.env.PATH ?? ''}`, npm_config_cache: path.join(runtimePackageDir, '.cache', 'dsh-runtime', 'npm') },
      });
      isolatePluginDependencies(pluginDestination, install.manifest, hostLock, pluginPackages[index].amiba?.distribution);
    }

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
      fsp.writeFile(path.join(pluginDestination, 'package.json'), `${JSON.stringify({
        ...pluginPackages[index],
        dependencies: pluginInstalls[index].manifest.dependencies,
        peerDependencies: Object.fromEntries(Object.entries({ ...pluginInstalls[index].manifest.peerDependencies, ...Object.fromEntries(Object.entries({ ...pluginPackages[index].dependencies, ...pluginPackages[index].peerDependencies }).filter(([name]) => name.startsWith('@amiba/dsh-plugin-'))) }).map(([name, version]) => [name, version.startsWith('workspace:') ? '*' : resolveCatalogSpecifier(name, version)])),
        devDependencies: undefined,
      }, null, 2)}\n`),
    ]);
    // Packaged skill resources live next to lib, and must also be replaced on
    // cache reuse so removed guides/scripts cannot remain in an installation.
    const skillDestination = path.join(pluginDestination, "skills");
    await fsp.rm(skillDestination, { recursive: true, force: true });
    if (pluginPackages[index].files?.includes("skills")) {
      await fsp.cp(path.join(pluginSourceDir, "skills"), skillDestination, { recursive: true });
    }
    const patch = pluginPackages[index].dsh?.bundle?.patch;
    // Root legal notices declared in package.files must accompany copied code,
    // including reused installations; lib-only copying loses these notices.
    for (const name of await fsp.readdir(pluginDestination)) {
      if (licenseName.test(name)) await fsp.rm(path.join(pluginDestination, name), { force: true });
    }
    for (const file of pluginLicenseAssets[index]) {
      await fsp.copyFile(file, path.join(pluginDestination, path.basename(file)));
    }
    if (patch) {
      await fsp.copyFile(path.join(pluginSourceDir, patch), path.join(pluginDestination, patch));
    }
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
  // Keep the files the reviewed patches write. Pruning a `*.d.ts` a patch
  // touches would make the NEXT preparation fail: a reused app tree is only
  // accepted after `applyManagedRuntimePatches` reverse-checks every patch,
  // and a reverse check cannot succeed once its target file is gone.
  const pruned = await pruneRuntime(stage, runtimePatchTargets(appDir, workspaceDir));
  console.log(`[dsh:runtime] pruned ${pruned} dev/cross-platform paths from the staged runtime`);
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
