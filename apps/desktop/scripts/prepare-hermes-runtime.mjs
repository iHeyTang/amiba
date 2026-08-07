import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await fsp.readFile(path.join(desktopDir, "hermes-runtime-manifest.json"), "utf8"),
);
const outputDir = path.join(desktopDir, "resources", "hermes-runtime");
const markerName = "runtime-manifest.json";
const args = new Set(process.argv.slice(2));
const sourceIndex = process.argv.indexOf("--source");
const localSource = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
const verifyOnly = args.has("--verify");
const force = args.has("--force") || process.env.AMIBA_HERMES_RUNTIME_REBUILD === "1";
const developmentBuild = args.has("--dev");
const skipBrowser = args.has("--skip-browser") || process.env.AMIBA_HERMES_SKIP_BROWSER === "1";
const platform = process.platform;
const arch = process.arch;

function fail(message) {
  throw new Error(`[hermes:runtime] ${message}`);
}

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
    const detail = options.capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    fail(`${command} exited with ${result.status}${detail}`);
  }
  return options.capture ? String(result.stdout).trim() : "";
}

function runtimePython(runtimeDir) {
  return platform === "win32"
    ? path.join(runtimeDir, "python", "python.exe")
    : path.join(runtimeDir, "python", "bin", `python${manifest.pythonVersion.split(".").slice(0, 2).join(".")}`);
}

function runtimeNodeBin(runtimeDir) {
  return platform === "win32"
    ? path.join(runtimeDir, "node")
    : path.join(runtimeDir, "node", "bin");
}

function expectedMarker() {
  return {
    schemaVersion: manifest.bundleSchemaVersion,
    hermesCommit: manifest.commit,
    hermesVersion: manifest.version,
    pythonVersion: manifest.pythonVersion,
    nodeVersion: manifest.nodeVersion,
    playwrightVersion: manifest.playwrightVersion,
    platform,
    arch,
  };
}

async function bundleIsCurrent(runtimeDir) {
  try {
    const actual = JSON.parse(await fsp.readFile(path.join(runtimeDir, markerName), "utf8"));
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
    return required.every((candidate) => fs.existsSync(candidate));
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) fail(`download failed (${response.status}): ${url}`);
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
  const distBase = `https://nodejs.org/dist/v${manifest.nodeVersion}`;
  const sums = new TextDecoder().decode(
    await download(`${distBase}/SHASUMS256.txt`, path.join(scratchDir, "SHASUMS256.txt")),
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
  if (localSource) {
    const source = path.resolve(desktopDir, localSource);
    if (!fs.existsSync(path.join(source, "pyproject.toml"))) fail(`invalid Hermes source: ${source}`);
    const head = run("git", ["rev-parse", "HEAD"], { cwd: source, capture: true });
    if (
      head !== manifest.commit &&
      !developmentBuild &&
      process.env.AMIBA_ALLOW_UNPINNED_HERMES_BUILD !== "1"
    ) {
      fail(`local Hermes HEAD is ${head}; release manifest pins ${manifest.commit}`);
    }
    await fsp.cp(source, destination, {
      recursive: true,
      filter: (candidate) => {
        const relative = path.relative(source, candidate);
        const first = relative.split(path.sep)[0];
        return ![".git", "venv", ".venv", "node_modules", "dist", "build"].includes(first);
      },
    });
    return;
  }

  await fsp.mkdir(destination, { recursive: true });
  run("git", ["init"], { cwd: destination });
  run("git", ["remote", "add", "origin", `https://github.com/${manifest.repository}.git`], {
    cwd: destination,
  });
  run("git", ["fetch", "--depth", "1", "origin", manifest.commit], { cwd: destination });
  run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: destination });
  const head = run("git", ["rev-parse", "HEAD"], { cwd: destination, capture: true });
  if (head !== manifest.commit) fail(`fetched Hermes commit ${head}, expected ${manifest.commit}`);
  await fsp.rm(path.join(destination, ".git"), { recursive: true, force: true });
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
  run(uv, ["python", "install", manifest.pythonVersion, "--install-dir", installRoot, "--no-bin"], {
    env: uvEnv,
  });
  const entries = (await fsp.readdir(installRoot, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory() && entry.name.startsWith(`cpython-${manifest.pythonVersion}-`),
  );
  if (entries.length !== 1) fail(`expected one portable Python, found ${entries.length}`);
  await fsp.rename(path.join(installRoot, entries[0].name), path.join(runtimeDir, "python"));

  const python = runtimePython(runtimeDir);
  const hermesSource = path.join(runtimeDir, "hermes-agent");
  const backendSource = path.resolve(desktopDir, "../../backend");
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
  const npm = platform === "win32" ? path.join(nodeBin, "npm.cmd") : path.join(nodeBin, "npm");
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
    run(node, [playwrightCli, "install", "chromium"], { cwd: playwrightInstaller, env });
    await fsp.cp(browserCache, path.join(runtimeDir, "browsers"), { recursive: true });
  }
}

async function main() {
  if (verifyOnly) {
    if (!(await bundleIsCurrent(outputDir))) fail("runtime bundle is missing or stale");
    console.log(`[hermes:runtime] verified ${platform}-${arch} bundle at ${outputDir}`);
    return;
  }
  if (!force && (await bundleIsCurrent(outputDir))) {
    console.log(`[hermes:runtime] reusing ${platform}-${arch} bundle at ${outputDir}`);
    return;
  }

  const buildRoot = await fsp.mkdtemp(path.join(desktopDir, ".hermes-runtime-build-"));
  const runtimeDir = path.join(buildRoot, "runtime");
  const scratchDir = path.join(buildRoot, "scratch");
  await fsp.mkdir(runtimeDir, { recursive: true });
  await fsp.mkdir(scratchDir, { recursive: true });
  try {
    console.log(`[hermes:runtime] preparing ${platform}-${arch} runtime`);
    await stageHermesSource(runtimeDir);
    await installPortableNode(runtimeDir, scratchDir);
    await installPortablePython(runtimeDir, scratchDir);
    await installNodeDependencies(runtimeDir, scratchDir);
    await fsp.writeFile(
      path.join(runtimeDir, markerName),
      `${JSON.stringify({ ...expectedMarker(), builtAt: new Date().toISOString() }, null, 2)}\n`,
    );

    const python = runtimePython(runtimeDir);
    run(python, [path.join(runtimeDir, "hermes-agent", "hermes"), "--help"], {
      env: { ...process.env, HERMES_HOME: path.join(scratchDir, "smoke-home") },
      capture: true,
    });
    await fsp.mkdir(path.dirname(outputDir), { recursive: true });
    await fsp.rm(outputDir, { recursive: true, force: true });
    await fsp.rename(runtimeDir, outputDir);
    console.log(`[hermes:runtime] ready: ${outputDir}`);
  } finally {
    await fsp.rm(buildRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
