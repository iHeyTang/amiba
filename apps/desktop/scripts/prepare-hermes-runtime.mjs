import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  HERMES_PATCH_COMPATIBILITY,
  classifyHermesPatchCompatibility,
} from "./hermes-patch-compatibility.mjs";

const desktopDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  await fsp.readFile(
    path.join(desktopDir, "hermes-runtime-manifest.json"),
    "utf8",
  ),
);
const outputDir = path.join(desktopDir, "resources", "hermes-runtime");
const backendSource = path.resolve(desktopDir, "../../backend");
const markerName = "runtime-manifest.json";
const args = new Set(process.argv.slice(2));
const sourceIndex = process.argv.indexOf("--source");
const localSource =
  sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
const verifyOnly = args.has("--verify");
const force =
  args.has("--force") || process.env.AMIBA_HERMES_RUNTIME_REBUILD === "1";
const developmentBuild = args.has("--dev");
const skipBrowser =
  args.has("--skip-browser") || process.env.AMIBA_HERMES_SKIP_BROWSER === "1";
const keepFailedBuild = process.env.AMIBA_HERMES_KEEP_FAILED_BUILD === "1";
const platform = process.platform;
const arch = process.arch;
const buildFlavor = developmentBuild ? "development" : "release";

let cachedBackplaneVersion;
function backplaneVersion() {
  if (cachedBackplaneVersion) return cachedBackplaneVersion;
  const pyproject = fs.readFileSync(
    path.join(backendSource, "pyproject.toml"),
    "utf8",
  );
  const version = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1];
  if (!version) fail("could not read the Backplane version");
  cachedBackplaneVersion = version;
  return cachedBackplaneVersion;
}

let cachedBackplaneSourceHash;
function backplaneSourceHash() {
  if (cachedBackplaneSourceHash) return cachedBackplaneSourceHash;
  const hash = createHash("sha256");
  const roots = ["pyproject.toml", "amiba_backplane"];
  const ignored = new Set(["__pycache__", ".pytest_cache", ".DS_Store"]);

  function add(relativePath) {
    const absolutePath = path.join(backendSource, relativePath);
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath).sort()) {
        if (ignored.has(name) || name.endsWith(".pyc")) continue;
        add(path.join(relativePath, name));
      }
      return;
    }
    if (!stat.isFile()) return;
    hash.update(relativePath.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  }

  for (const relativePath of roots) add(relativePath);
  cachedBackplaneSourceHash = hash.digest("hex");
  return cachedBackplaneSourceHash;
}

function fail(message) {
  throw new Error(`[hermes:runtime] ${message}`);
}

if (sourceIndex >= 0 && (!localSource || localSource.startsWith("--"))) {
  fail("--source requires a Hermes source directory");
}
if (developmentBuild && !localSource) {
  fail(
    "local Runtime preparation requires an explicit Hermes source. " +
      "From the repository root, run: " +
      "pnpm runtime:prepare:local -- --source /path/to/hermes-agent",
  );
}

const localSourcePath = localSource
  ? path.resolve(process.cwd(), localSource)
  : undefined;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? desktopDir,
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

function probe(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? desktopDir,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function runtimePython(runtimeDir) {
  return platform === "win32"
    ? path.join(runtimeDir, "python", "python.exe")
    : path.join(
        runtimeDir,
        "python",
        "bin",
        `python${manifest.pythonVersion.split(".").slice(0, 2).join(".")}`,
      );
}

function runtimeNodeBin(runtimeDir) {
  return platform === "win32"
    ? path.join(runtimeDir, "node")
    : path.join(runtimeDir, "node", "bin");
}

let cachedSourceRevision;
function sourceRevision() {
  if (cachedSourceRevision) return cachedSourceRevision;
  if (!localSourcePath) {
    cachedSourceRevision = manifest.commit;
    return cachedSourceRevision;
  }
  const source = localSourcePath;
  if (!fs.existsSync(path.join(source, "pyproject.toml"))) {
    fail(`invalid Hermes source: ${source}`);
  }
  const hash = createHash("sha256");
  hash.update(
    run("git", ["rev-parse", "HEAD"], { cwd: source, capture: true }),
  );
  hash.update("\0");
  hash.update(
    run("git", ["diff", "--binary", "HEAD"], { cwd: source, capture: true }),
  );
  hash.update("\0");
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: source,
    capture: true,
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  for (const relative of untracked) {
    hash.update(relative);
    hash.update("\0");
    hash.update(
      run("git", ["hash-object", "--", relative], {
        cwd: source,
        capture: true,
      }),
    );
    hash.update("\0");
  }
  cachedSourceRevision = hash.digest("hex");
  return cachedSourceRevision;
}

function patchDefinitions() {
  if (!Array.isArray(manifest.patches)) {
    fail("runtime manifest patches must be an array");
  }
  const ids = new Set();
  return manifest.patches.map((patch, index) => {
    if (!patch || typeof patch !== "object")
      fail(`patch ${index} must be an object`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(patch.id ?? "")) {
      fail(`patch ${index} has an invalid id`);
    }
    if (ids.has(patch.id)) fail(`duplicate patch id: ${patch.id}`);
    ids.add(patch.id);
    for (const field of ["file", "verifier"]) {
      if (typeof patch[field] !== "string" || patch[field].length === 0) {
        fail(`patch ${patch.id} has an invalid ${field}`);
      }
    }
    for (const field of ["sha256", "verifierSha256"]) {
      if (!/^[0-9a-f]{64}$/.test(patch[field] ?? "")) {
        fail(`patch ${patch.id} has an invalid ${field}`);
      }
    }
    return patch;
  });
}

function patchSetHash(patches = patchDefinitions()) {
  const hash = createHash("sha256");
  for (const patch of patches) {
    for (const value of [
      patch.id,
      patch.file,
      patch.sha256,
      patch.verifier,
      patch.verifierSha256,
    ]) {
      hash.update(value);
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

function managedAssetPath(relativePath, label) {
  const resolved = path.resolve(desktopDir, relativePath);
  const relative = path.relative(desktopDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} must stay inside the desktop project`);
  }
  return resolved;
}

async function verifyPatchAssets() {
  const patches = patchDefinitions();
  for (const patch of patches) {
    for (const [field, checksumField] of [
      ["file", "sha256"],
      ["verifier", "verifierSha256"],
    ]) {
      const asset = managedAssetPath(patch[field], `${patch.id} ${field}`);
      let bytes;
      try {
        bytes = await fsp.readFile(asset);
      } catch (error) {
        fail(`could not read ${patch.id} ${field}: ${error.message}`);
      }
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== patch[checksumField]) {
        fail(
          `${patch.id} ${field} checksum mismatch: expected ${patch[checksumField]}, got ${actual}`,
        );
      }
    }
  }
  return patches;
}

function expectedMarker() {
  return {
    schemaVersion: manifest.bundleSchemaVersion,
    hermesCommit: manifest.commit,
    hermesVersion: manifest.version,
    pythonVersion: manifest.pythonVersion,
    nodeVersion: manifest.nodeVersion,
    playwrightVersion: manifest.playwrightVersion,
    hermesPatchSetHash: patchSetHash(),
    buildFlavor,
    sourceRevision: sourceRevision(),
    backplaneVersion: backplaneVersion(),
    backplaneSourceHash: backplaneSourceHash(),
    platform,
    arch,
  };
}

async function bundleIsCurrent(runtimeDir) {
  try {
    const actual = JSON.parse(
      await fsp.readFile(path.join(runtimeDir, markerName), "utf8"),
    );
    const expected = expectedMarker();
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) return false;
    }
    const required = [
      runtimePython(runtimeDir),
      path.join(runtimeDir, "hermes-agent", "hermes"),
      platform === "win32"
        ? path.join(runtimeNodeBin(runtimeDir), "node.exe")
        : path.join(runtimeNodeBin(runtimeDir), "node"),
    ];
    if (!required.every((candidate) => fs.existsSync(candidate))) return false;
    const backplane = probe(
      runtimePython(runtimeDir),
      [
        "-I",
        "-c",
        'from importlib.metadata import version; import amiba_backplane; print(version("amiba-backplane"))',
      ],
      { capture: true },
    );
    return backplane.ok && backplane.output === backplaneVersion();
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body)
    fail(`download failed (${response.status}): ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fsp.writeFile(destination, bytes);
  return bytes;
}

function nodePlatformName() {
  if (platform === "win32") return "win";
  if (platform === "darwin") return "darwin";
  if (platform === "linux") return "linux";
  fail(`unsupported packaging platform: ${platform}`);
}

function nodeArchName() {
  if (arch === "x64" || arch === "arm64") return arch;
  fail(`unsupported packaging architecture: ${arch}`);
}

async function installPortableNode(runtimeDir, scratchDir) {
  const base = `node-v${manifest.nodeVersion}-${nodePlatformName()}-${nodeArchName()}`;
  const archiveName = platform === "win32" ? `${base}.zip` : `${base}.tar.gz`;
  const nodeDistRoot = (
    process.env.AMIBA_NODE_DIST_URL ?? "https://nodejs.org/dist"
  ).replace(/\/+$/, "");
  const distBase = `${nodeDistRoot}/v${manifest.nodeVersion}`;
  const sums = new TextDecoder().decode(
    await download(
      `${distBase}/SHASUMS256.txt`,
      path.join(scratchDir, "SHASUMS256.txt"),
    ),
  );
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.at(-1) === archiveName)?.[0];
  if (!expected) fail(`Node checksum is missing for ${archiveName}`);
  const archive = path.join(scratchDir, archiveName);
  const bytes = await download(`${distBase}/${archiveName}`, archive);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) fail(`Node checksum mismatch for ${archiveName}`);

  const extractDir = path.join(scratchDir, "node-extract");
  await fsp.mkdir(extractDir, { recursive: true });
  if (platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force`,
    ]);
  } else {
    run("tar", ["-xzf", archive, "-C", extractDir]);
  }
  await fsp.rename(path.join(extractDir, base), path.join(runtimeDir, "node"));
}

async function stageHermesSource(runtimeDir) {
  const destination = path.join(runtimeDir, "hermes-agent");
  if (localSourcePath) {
    const source = localSourcePath;
    if (!fs.existsSync(path.join(source, "pyproject.toml")))
      fail(`invalid Hermes source: ${source}`);
    const head = run("git", ["rev-parse", "HEAD"], {
      cwd: source,
      capture: true,
    });
    if (
      head !== manifest.commit &&
      !developmentBuild &&
      process.env.AMIBA_ALLOW_UNPINNED_HERMES_BUILD !== "1"
    ) {
      fail(
        `local Hermes HEAD is ${head}; release manifest pins ${manifest.commit}`,
      );
    }
    await fsp.cp(source, destination, {
      recursive: true,
      filter: (candidate) => {
        const relative = path.relative(source, candidate);
        const first = relative.split(path.sep)[0];
        return ![
          ".git",
          "venv",
          ".venv",
          "node_modules",
          "dist",
          "build",
        ].includes(first);
      },
    });
    return;
  }

  await fsp.mkdir(destination, { recursive: true });
  run("git", ["init"], { cwd: destination });
  run(
    "git",
    [
      "remote",
      "add",
      "origin",
      `https://github.com/${manifest.repository}.git`,
    ],
    {
      cwd: destination,
    },
  );
  run("git", ["fetch", "--depth", "1", "origin", manifest.commit], {
    cwd: destination,
  });
  run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: destination });
  const head = run("git", ["rev-parse", "HEAD"], {
    cwd: destination,
    capture: true,
  });
  if (head !== manifest.commit)
    fail(`fetched Hermes commit ${head}, expected ${manifest.commit}`);
  await fsp.rm(path.join(destination, ".git"), {
    recursive: true,
    force: true,
  });
}

function patchVerifierProbe(runtimeDir, scratchDir, patch) {
  const source = path.join(runtimeDir, "hermes-agent");
  const python = runtimePython(runtimeDir);
  const verifier = managedAssetPath(patch.verifier, `${patch.id} verifier`);
  return probe(python, [verifier, source], {
    cwd: source,
    env: {
      ...process.env,
      HERMES_HOME: path.join(scratchDir, "patch-contract-home"),
      PYTHONPATH: source,
    },
  });
}

function applyAndVerifyHermesPatches(runtimeDir, scratchDir, patches) {
  const source = path.join(runtimeDir, "hermes-agent");
  const temporaryGitDir = path.join(source, ".git");
  if (fs.existsSync(temporaryGitDir)) {
    fail("staged Hermes source unexpectedly retained Git metadata");
  }
  // The build tree lives inside Amiba's own worktree. Without an inner .git,
  // `git apply` walks upward and treats Amiba as the target repository, which
  // can make a check succeed without touching the staged Hermes files. A
  // throwaway repository pins path resolution to this source copy.
  run("git", ["init", "--quiet"], { cwd: source });
  try {
    for (const patch of patches) {
      const patchFile = managedAssetPath(patch.file, `${patch.id} file`);
      const unpatchedVerification = patchVerifierProbe(
        runtimeDir,
        scratchDir,
        patch,
      );
      const applyCheck = unpatchedVerification.ok
        ? {
            ok: false,
            output: "not checked because the contract already passes",
          }
        : probe(
            "git",
            ["apply", "--check", "--whitespace=error-all", patchFile],
            {
              cwd: source,
            },
          );
      const compatibility = classifyHermesPatchCompatibility({
        verifierPasses: unpatchedVerification.ok,
        patchApplies: applyCheck.ok,
      });

      if (compatibility === HERMES_PATCH_COMPATIBILITY.RETIRE) {
        fail(
          `patch ${patch.id} can be retired: unpatched Hermes already satisfies ` +
            `${patch.verifier}. Remove its manifest declaration and assets, then ` +
            "rebuild the Runtime. The patch-set hash invalidates the old bundle; " +
            "bundleSchemaVersion only changes when the bundle layout or runtime contract changes.",
        );
      }
      if (compatibility === HERMES_PATCH_COMPATIBILITY.CONFLICT) {
        fail(
          `patch ${patch.id} needs a manual rebase: unpatched Hermes does not satisfy ` +
            `its verifier and the diff no longer applies.\n` +
            `Verifier output:\n${unpatchedVerification.output || "(no output)"}\n` +
            `git apply --check output:\n${applyCheck.output || "(no output)"}`,
        );
      }

      console.log(
        `[hermes:runtime] patch ${patch.id}: required; applying diff`,
      );
      run("git", ["apply", "--whitespace=error-all", patchFile], {
        cwd: source,
      });
      const patchedVerification = patchVerifierProbe(
        runtimeDir,
        scratchDir,
        patch,
      );
      if (!patchedVerification.ok) {
        fail(
          `patch ${patch.id} applied but its verifier failed:\n` +
            `${patchedVerification.output || "(no output)"}`,
        );
      }
      console.log(`[hermes:runtime] patch ${patch.id}: behavior verified`);
    }
  } finally {
    fs.rmSync(temporaryGitDir, { recursive: true, force: true });
  }
}

async function installPortablePython(runtimeDir, scratchDir) {
  const uv = process.env.UV ?? (platform === "win32" ? "uv.exe" : "uv");
  const installRoot = path.join(scratchDir, "python-install");
  const uvEnv = {
    ...process.env,
    // Keep downloads between failed/retried local builds. The final artifact
    // never contains this cache, and CI starts from an empty workspace anyway.
    UV_CACHE_DIR: path.join(desktopDir, ".cache", "hermes-runtime", "uv"),
    UV_NO_CONFIG: "1",
    UV_NO_PROGRESS: "1",
  };
  run(
    uv,
    [
      "python",
      "install",
      manifest.pythonVersion,
      "--install-dir",
      installRoot,
      "--no-bin",
    ],
    {
      env: uvEnv,
    },
  );
  const entries = (
    await fsp.readdir(installRoot, { withFileTypes: true })
  ).filter(
    (entry) =>
      entry.isDirectory() &&
      entry.name.startsWith(`cpython-${manifest.pythonVersion}-`),
  );
  if (entries.length !== 1)
    fail(`expected one portable Python, found ${entries.length}`);
  await fsp.rename(
    path.join(installRoot, entries[0].name),
    path.join(runtimeDir, "python"),
  );

  const python = runtimePython(runtimeDir);
  const hermesSource = path.join(runtimeDir, "hermes-agent");
  run(
    uv,
    [
      "pip",
      "install",
      "--python",
      python,
      "--system",
      // uv's portable CPython intentionally carries EXTERNALLY-MANAGED. This
      // interpreter is a disposable, app-owned artifact rather than a user's
      // system Python, so populating it is the explicit purpose of this build.
      "--break-system-packages",
      "--link-mode",
      "copy",
      // Hermes deliberately blocks wheel/sdist builds and officially supports
      // editable installs. Runtime execution uses the bundled source via an
      // explicit entrypoint/PYTHONPATH, so the build-directory .pth is ignored
      // after relocation while all resolved dependencies remain installed.
      "--editable",
      `${hermesSource}[all]`,
      backendSource,
    ],
    { env: uvEnv },
  );
}

async function installNodeDependencies(runtimeDir, scratchDir) {
  const source = path.join(runtimeDir, "hermes-agent");
  const nodeBin = runtimeNodeBin(runtimeDir);
  const delimiter = platform === "win32" ? ";" : ":";
  const browserCache = path.join(
    desktopDir,
    ".cache",
    "hermes-runtime",
    "browsers",
    `${platform}-${arch}-playwright-${manifest.playwrightVersion}`,
  );
  const env = {
    ...process.env,
    HOME: path.join(scratchDir, "home"),
    USERPROFILE: path.join(scratchDir, "home"),
    PLAYWRIGHT_BROWSERS_PATH: browserCache,
    npm_config_cache: path.join(desktopDir, ".cache", "hermes-runtime", "npm"),
    PATH: `${nodeBin}${delimiter}${process.env.PATH ?? ""}`,
  };
  const npm =
    platform === "win32"
      ? path.join(nodeBin, "npm.cmd")
      : path.join(nodeBin, "npm");
  // Hermes is a workspace monorepo, but Amiba embeds only the agent runtime.
  // Installing every workspace would add Hermes's own Electron/TUI/Web build
  // trees (~1.4 GB) to our application for no runtime benefit.
  run(npm, ["ci", "--workspaces=false", "--omit=dev"], { cwd: source, env });
  if (!skipBrowser) {
    // Keep Playwright's installer outside the Hermes workspace. Adding it at
    // the repo root makes npm resolve unrelated TUI peer dependencies. Only
    // the downloaded browser payload belongs in the final runtime.
    const playwrightInstaller = path.join(scratchDir, "playwright-installer");
    fs.mkdirSync(playwrightInstaller, { recursive: true });
    fs.writeFileSync(
      path.join(playwrightInstaller, "package.json"),
      `${JSON.stringify({ name: "amiba-playwright-installer", private: true }, null, 2)}\n`,
    );
    run(
      npm,
      [
        "install",
        "--package-lock=false",
        "--omit=dev",
        `@playwright/test@${manifest.playwrightVersion}`,
      ],
      { cwd: playwrightInstaller, env },
    );
    const playwrightCli = path.join(
      playwrightInstaller,
      "node_modules",
      "@playwright",
      "test",
      "cli.js",
    );
    const node = path.join(nodeBin, platform === "win32" ? "node.exe" : "node");
    run(node, [playwrightCli, "install", "chromium"], {
      cwd: playwrightInstaller,
      env,
    });
    await fsp.cp(browserCache, path.join(runtimeDir, "browsers"), {
      recursive: true,
    });
  }
}

async function main() {
  const patches = await verifyPatchAssets();
  if (verifyOnly) {
    if (!(await bundleIsCurrent(outputDir)))
      fail("runtime bundle is missing or stale");
    console.log(
      `[hermes:runtime] verified ${platform}-${arch} bundle at ${outputDir}`,
    );
    return;
  }
  if (!force && (await bundleIsCurrent(outputDir))) {
    console.log(
      `[hermes:runtime] reusing ${platform}-${arch} bundle at ${outputDir}`,
    );
    return;
  }

  const buildRoot = await fsp.mkdtemp(
    path.join(desktopDir, ".hermes-runtime-build-"),
  );
  const runtimeDir = path.join(buildRoot, "runtime");
  const scratchDir = path.join(buildRoot, "scratch");
  await fsp.mkdir(runtimeDir, { recursive: true });
  await fsp.mkdir(scratchDir, { recursive: true });
  let completed = false;
  try {
    console.log(`[hermes:runtime] preparing ${platform}-${arch} runtime`);
    await stageHermesSource(runtimeDir);
    await installPortablePython(runtimeDir, scratchDir);
    applyAndVerifyHermesPatches(runtimeDir, scratchDir, patches);
    await installPortableNode(runtimeDir, scratchDir);
    await installNodeDependencies(runtimeDir, scratchDir);
    await fsp.writeFile(
      path.join(runtimeDir, markerName),
      `${JSON.stringify(
        {
          ...expectedMarker(),
          appliedPatches: patches.map(({ id, sha256 }) => ({ id, sha256 })),
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    const python = runtimePython(runtimeDir);
    run(python, [path.join(runtimeDir, "hermes-agent", "hermes"), "--help"], {
      env: { ...process.env, HERMES_HOME: path.join(scratchDir, "smoke-home") },
      capture: true,
    });
    await fsp.mkdir(path.dirname(outputDir), { recursive: true });
    await fsp.rm(outputDir, { recursive: true, force: true });
    await fsp.rename(runtimeDir, outputDir);
    completed = true;
    console.log(`[hermes:runtime] ready: ${outputDir}`);
  } finally {
    if (!completed && keepFailedBuild) {
      console.error(
        `[hermes:runtime] preserved failed build for inspection: ${buildRoot}`,
      );
    } else {
      await fsp.rm(buildRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
