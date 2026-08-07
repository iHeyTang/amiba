/**
 * Hermes-agent lifecycle plumbing for the onboarding wizard.
 *
 * Three responsibilities:
 *
 *   1. Detect Amiba's pinned, app-owned Hermes runtime. A system `hermes`
 *      is deliberately ignored so Amiba never mutates another installation.
 *
 *   2. Run install / plugin-install commands as background jobs and
 *      stream stdout/stderr back to the renderer line by line. The
 *      renderer never blocks waiting for completion — it subscribes to
 *      `hermes:job-log` + `hermes:job-end` and renders the tail live.
 *
 *   3. Supervise the two long-running backend processes: the gateway
 *      (`hermes gateway` — the agent that runs chat/LLM/tools) and the
 *      backplane server (`amiba-backplane` — the app-private HTTP front door
 *      that serves /hermes/* + /integrations/* and proxies /v1/* to the gateway).
 *      Both killed on app quit so the next launch isn't blocked by a stale
 *      listener. (The backplane used to be a plugin loaded *inside* the
 *      gateway; it's now its own process desktop spawns + supervises.)
 *
 * We deliberately do NOT try to be smart about plugin-list parsing here.
 * `hermes plugins install <id>` is idempotent on the hermes side, so
 * the wizard just re-runs both during onboarding without first checking
 * what's already installed. Simpler and safer.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import type { IPty } from "node-pty";
import {
  buildHermesRuntimeEnv,
  fileExists,
  resolveExecutableTarget,
  resolveOnPath,
  runQuiet,
} from "./hermes-discovery";
import {
  MANAGED_HERMES_RUNTIME,
  bundledHermesRuntimeDir,
  buildManagedHermesEnvironment,
  expectedBundledHermesRuntimeMarker,
  resolveManagedHermesPaths,
  type BundledHermesRuntimeMarker,
  type ManagedHermesPaths,
} from "./managed-hermes-runtime";
import { getDefaultWorkspaceRoot } from "./workspace-root";

/**
 * `node-pty` is a native module — loading it eagerly would crash the
 * main process if `electron-builder install-app-deps` hasn't rebuilt
 * the binding for this Electron version yet. Defer the require so the
 * failure surfaces only when the user actually triggers a PTY job, and
 * non-PTY paths (plugin install, backplane) keep working.
 */
let ptyMod: typeof import("node-pty") | null = null;
function getPty(): typeof import("node-pty") {
  if (!ptyMod) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyMod = require("node-pty") as typeof import("node-pty");
  }
  return ptyMod;
}

const USER_HOME = os.homedir();
const DEFAULT_WORKSPACE_ROOT = getDefaultWorkspaceRoot();
const IS_WIN = process.platform === "win32";

function managedHermesPaths(): ManagedHermesPaths {
  const override = process.env.AMIBA_HERMES_USER_DATA_DIR;
  const userDataDir =
    override && path.isAbsolute(override) ? override : app.getPath("userData");
  return resolveManagedHermesPaths(userDataDir, process.platform);
}

function bundledRuntimeDir(): string {
  return bundledHermesRuntimeDir(
    app.getAppPath(),
    process.resourcesPath,
    app.isPackaged,
    process.env.AMIBA_HERMES_RUNTIME_BUNDLE,
    process.platform,
  );
}

function managedHermesSourceDir(paths = managedHermesPaths()): string {
  const override = process.env.AMIBA_HERMES_DEV_SOURCE;
  if (!override) return paths.installDir;
  if (!path.isAbsolute(override)) {
    throw new Error("AMIBA_HERMES_DEV_SOURCE must be an absolute path");
  }
  return path.normalize(override);
}

function managedHermesEntrypoint(paths = managedHermesPaths()): string {
  return path.join(managedHermesSourceDir(paths), "hermes");
}

function hermesArgs(args: readonly string[], paths = managedHermesPaths()): string[] {
  return [managedHermesEntrypoint(paths), ...args];
}

function managedHermesEnv(
  extraPathEntries: readonly string[] = [],
  installer = false,
): NodeJS.ProcessEnv {
  const paths = managedHermesPaths();
  const sourceDir = managedHermesSourceDir(paths);
  // In joint-debug mode the Python entrypoint comes from the live checkout,
  // but Node helpers (notably agent-browser) remain release-bundle assets.
  // Keep their .bin directory on PATH so a developer does not need a second
  // npm install in the live Hermes checkout.
  const bundledNodeModulesBin = path.join(
    paths.installDir,
    "node_modules",
    ".bin",
  );
  const backplaneSource = resolveBackplaneSource();
  const pythonPath = [sourceDir, backplaneSource, process.env.PYTHONPATH]
    .filter((value): value is string => !!value)
    .join(path.delimiter);
  const source = buildManagedHermesEnvironment(process.env, paths);
  source.HERMES_INSTALL_DIR = sourceDir;
  source.PYTHONPATH = pythonPath;
  if (installer && !IS_WIN) source.HOME = paths.installerHome;
  return buildHermesRuntimeEnv(
    source,
    installer && !IS_WIN ? paths.installerHome : USER_HOME,
    [
      paths.nodeBinDir,
      bundledNodeModulesBin,
      path.dirname(paths.binary),
      ...extraPathEntries,
    ],
  );
}

/**
 * Plugins the first-run configure flow installs into the gateway — deliberately
 * EMPTY. Nothing the desktop needs to boot is a hermes plugin anymore:
 * `http-backplane` became the standalone server the desktop spawns (see
 * {@link startBackend}); `integrations` moved INTO the backplane (vendored —
 * nothing to install). And `browser-tools`, while a genuine plugin, is an
 * OPTIONAL capability — the user opts in from the "Browser" featured-feature
 * settings page (which hands the install to the agent), so it must NOT block
 * onboarding. So a fresh machine just needs Hermes + the backplane; no plugin
 * clones, no GitHub dependency at first run.
 */
export const REQUIRED_PLUGINS: readonly string[] = [];

/**
 * The on-disk directory name a plugin lives under — `~/.hermes/plugins/<name>`.
 * Strip the GitHub `user/` prefix; everything after the last `/` is the dir.
 */
function pluginDirName(pluginId: string): string {
  const slash = pluginId.lastIndexOf("/");
  return slash >= 0 ? pluginId.slice(slash + 1) : pluginId;
}

/**
 * Best-effort: which of the required plugins are already on disk. Returns
 * the matching subset of `pluginIds`. Used so the wizard can skip already-
 * installed plugins instead of crashing on "already exists".
 */
export async function listInstalledPlugins(
  pluginIds: readonly string[],
): Promise<string[]> {
  const installed: string[] = [];
  for (const id of pluginIds) {
    const dir = path.join(
      managedHermesPaths().hermesHome,
      "plugins",
      pluginDirName(id),
    );
    if (await fileExists(dir)) installed.push(id);
  }
  return installed;
}

/**
 * The release bundle is the only supported runtime source. This string is
 * renderer-facing status text kept behind the legacy display-command bridge;
 * it is intentionally not a curl/source-install command.
 */
export function managedInstallDisplayCommand(): string {
  return `Bundled Hermes ${MANAGED_HERMES_RUNTIME.version} (${MANAGED_HERMES_RUNTIME.commit.slice(0, 12)}) — no download required`;
}

function bundleMarkerMatches(marker: BundledHermesRuntimeMarker): boolean {
  const expected = expectedBundledHermesRuntimeMarker(process.platform, process.arch);
  return (Object.keys(expected) as (keyof BundledHermesRuntimeMarker)[]).every(
    (key) => marker[key] === expected[key],
  );
}

async function readBundleMarker(directory: string): Promise<BundledHermesRuntimeMarker | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(directory, "runtime-manifest.json"), "utf8"),
    ) as BundledHermesRuntimeMarker;
  } catch {
    return null;
  }
}

async function runtimeFilesReady(paths = managedHermesPaths()): Promise<boolean> {
  const marker = await readBundleMarker(paths.runtimeDir);
  if (!marker || !bundleMarkerMatches(marker)) return false;
  const node = path.join(paths.nodeBinDir, IS_WIN ? "node.exe" : "node");
  return (
    (await fileExists(paths.python)) &&
    (await fileExists(managedHermesEntrypoint(paths))) &&
    (await fileExists(node))
  );
}

let bundledRuntimeInstall: Promise<ManagedHermesPaths> | null = null;

/**
 * Copy the platform runtime shipped inside the app into the writable app-owned
 * runtime directory. The operation is local-only and atomic: a partial copy is
 * never exposed as the active runtime.
 */
async function installBundledRuntime(): Promise<ManagedHermesPaths> {
  if (bundledRuntimeInstall) return bundledRuntimeInstall;
  bundledRuntimeInstall = (async () => {
    const paths = managedHermesPaths();
    if (await runtimeFilesReady(paths)) return paths;

    const bundle = bundledRuntimeDir();
    const marker = await readBundleMarker(bundle);
    if (!marker) {
      throw new Error(
        `Hermes runtime bundle is missing at ${bundle}. Run pnpm --filter @amiba/desktop runtime:prepare.`,
      );
    }
    if (!bundleMarkerMatches(marker)) {
      throw new Error(
        `Hermes runtime bundle targets ${marker.platform}-${marker.arch} / ${marker.hermesCommit}; ` +
          `this app requires ${process.platform}-${process.arch} / ${MANAGED_HERMES_RUNTIME.commit}.`,
      );
    }

    const staging = `${paths.runtimeDir}.install-${randomUUID()}`;
    await fs.mkdir(path.dirname(paths.runtimeDir), { recursive: true });
    await fs.rm(staging, { recursive: true, force: true });
    try {
      await fs.cp(bundle, staging, { recursive: true, force: false });
      await fs.rm(paths.runtimeDir, { recursive: true, force: true });
      await fs.rename(staging, paths.runtimeDir);
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    if (!(await runtimeFilesReady(paths))) {
      throw new Error("Bundled Hermes runtime failed post-copy validation");
    }
    return paths;
  })();
  try {
    return await bundledRuntimeInstall;
  } finally {
    bundledRuntimeInstall = null;
  }
}

async function copyIfMissing(source: string, destination: string): Promise<void> {
  if (await fileExists(destination)) return;
  if (!(await fileExists(source))) return;
  await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

/** Create durable configuration scaffolding without contacting the network. */
async function seedManagedHermesHome(paths: ManagedHermesPaths): Promise<void> {
  const homeDirs = [
    "cron",
    "sessions",
    "logs",
    "pairing",
    "hooks",
    "image_cache",
    "audio_cache",
    "memories",
    "skills",
  ];
  await Promise.all(
    homeDirs.map((name) => fs.mkdir(path.join(paths.hermesHome, name), { recursive: true })),
  );
  const source = managedHermesSourceDir(paths);
  await copyIfMissing(path.join(source, ".env.example"), path.join(paths.hermesHome, ".env"));
  await copyIfMissing(
    path.join(source, "cli-config.yaml.example"),
    path.join(paths.hermesHome, "config.yaml"),
  );
  if (!IS_WIN) await fs.chmod(path.join(paths.hermesHome, ".env"), 0o600).catch(() => {});

  const skillsSync = path.join(source, "tools", "skills_sync.py");
  if (await fileExists(skillsSync)) {
    const result = await runQuiet(paths.python, [skillsSync], 60_000, managedHermesEnv());
    if (result.code !== 0) {
      console.warn("[hermes:runtime] bundled skills sync failed:", result.stderr || result.stdout);
    }
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectionResult {
  installed: boolean;
  /** Absolute path of the binary that passed the local CLI probe. */
  binary?: string;
  /** Kept optional for bridge compatibility; startup never performs a networked version check. */
  version?: string;
}

export async function detectHermes(): Promise<DetectionResult> {
  const paths = managedHermesPaths();
  if (!(await runtimeFilesReady(paths))) return { installed: false };
  if (!(await fileExists(managedHermesEntrypoint(paths)))) return { installed: false };
  const probe = await runQuiet(
    paths.python,
    hermesArgs(["--help"], paths),
    10_000,
    managedHermesEnv(),
  );
  if (probe.code === 0 && /Hermes Agent/i.test(`${probe.stdout}\n${probe.stderr}`)) {
    await writeCachedHermesBinary(paths.binary);
    return { installed: true, binary: paths.binary, version: MANAGED_HERMES_RUNTIME.version };
  }
  return { installed: false };
}

const HERMES_RUNTIME_STATE_FILE = "hermes-runtime.json";

async function writeCachedHermesBinary(binary: string): Promise<void> {
  const statePath = path.join(
    app.getPath("userData"),
    HERMES_RUNTIME_STATE_FILE,
  );
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({
        version: 2,
        mode: "managed",
        commit: MANAGED_HERMES_RUNTIME.commit,
        binary,
      }, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(temporaryPath, statePath);
  } catch (error) {
    console.warn("[hermes:detect] could not persist resolved binary:", error);
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Job manager — long-running spawns that stream logs back to renderers
// ---------------------------------------------------------------------------

type JobKind =
  | "install-hermes"
  | "install-plugin"
  | "install-backplane"
  | "start-gateway"
  | "start-backplane-server";

interface Job {
  id: string;
  kind: JobKind;
  child: ChildProcess;
}

const jobs = new Map<string, Job>();
// The two supervised long-runners (see startBackend). Each kept in its own
// slot so app-quit / stop-backplane can target both.
let gatewayJob: Job | null = null;
let backplaneServerJob: Job | null = null;

/**
 * PTY-backed jobs run alongside the pipe-backed ones in a separate map.
 * Same job-end IPC contract, but output is streamed as raw byte chunks
 * over `hermes:pty-data` (no line splitting, ANSI preserved) so xterm.js
 * in the renderer can render the install.sh setup wizard as if it were
 * being run in a real terminal — which is the whole point of going PTY
 * here instead of pipes.
 */
interface PtyJob {
  id: string;
  kind: "install-hermes-pty";
  pty: IPty;
  exited: boolean;
}

const ptyJobs = new Map<string, PtyJob>();

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

interface SpawnOpts {
  cwd?: string;
  /** Extra env vars merged on top of `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Pass `true` to invoke the command through the platform's shell. */
  shell?: boolean | string;
}

function startJob(
  kind: JobKind,
  cmd: string,
  args: string[],
  opts: SpawnOpts = {},
): { id: string; pid: number | undefined } {
  const id = randomUUID();
  const runtimeEnv = managedHermesEnv(
    path.isAbsolute(cmd) ? [path.dirname(cmd)] : [],
  );
  const child = spawn(cmd, args, {
    shell: opts.shell ?? false,
    cwd: opts.cwd ?? DEFAULT_WORKSPACE_ROOT,
    env: {
      ...runtimeEnv,
      ...opts.env,
      // Force-disable any "did you mean to use a TTY?" colourisation —
      // line-buffered streaming to the renderer reads cleaner without
      // ANSI sequences sprayed everywhere.
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    // The install scripts MUST NOT prompt for stdin (we have no TTY to
    // forward); attach /dev/null equivalent by ignoring stdin so any
    // read blocks immediately rather than hanging.
    stdio: ["ignore", "pipe", "pipe"],
  });

  const job: Job = { id, kind, child };
  jobs.set(id, job);
  if (kind === "start-gateway") gatewayJob = job;
  else if (kind === "start-backplane-server") backplaneServerJob = job;

  let outBuf = "";
  let errBuf = "";
  // Accumulated lines, kept only so `finish()` can pattern-match the
  // output of an install-plugin job (the CLI errors with non-zero exit
  // when the plugin is already on disk — we treat that as success).
  let combinedOutput = "";

  function flushLines(stream: "stdout" | "stderr", buf: string): string {
    let rest = buf;
    for (;;) {
      const nl = rest.indexOf("\n");
      if (nl < 0) break;
      const line = rest.slice(0, nl).replace(/\r$/, "");
      rest = rest.slice(nl + 1);
      combinedOutput += line + "\n";
      broadcast("hermes:job-log", { jobId: id, stream, line });
    }
    return rest;
  }

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    outBuf = flushLines("stdout", outBuf + chunk);
  });
  child.stderr?.on("data", (chunk: string) => {
    errBuf = flushLines("stderr", errBuf + chunk);
  });

  function finish(code: number | null, error?: string) {
    // Flush whatever partial line is left so the renderer doesn't lose
    // the last "Done." line that lacked a trailing \n.
    if (outBuf) {
      combinedOutput += outBuf + "\n";
      broadcast("hermes:job-log", {
        jobId: id,
        stream: "stdout",
        line: outBuf,
      });
    }
    if (errBuf) {
      combinedOutput += errBuf + "\n";
      broadcast("hermes:job-log", {
        jobId: id,
        stream: "stderr",
        line: errBuf,
      });
    }
    outBuf = "";
    errBuf = "";
    let effectiveCode = code;
    if (
      kind === "install-plugin" &&
      code !== 0 &&
      /plugin .* already exists/i.test(combinedOutput)
    ) {
      // Idempotent success: the plugin is already on disk. Report code 0
      // so the renderer marches on to the next plugin instead of erroring.
      effectiveCode = 0;
    }
    broadcast("hermes:job-end", { jobId: id, exitCode: effectiveCode, error });
    jobs.delete(id);
    if (gatewayJob?.id === id) gatewayJob = null;
    if (backplaneServerJob?.id === id) backplaneServerJob = null;
  }

  child.on("error", (err) => finish(null, err.message));
  child.on("exit", (code) => finish(code));

  return { id, pid: child.pid };
}

function killJob(jobId: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  try {
    job.child.kill(signal);
  } catch {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Specific spawn helpers
// ---------------------------------------------------------------------------

async function startInstallHermes(): Promise<{ id: string; pid: number | undefined }> {
  const paths = await installBundledRuntime();
  await seedManagedHermesHome(paths);
  return startJob(
    "install-hermes",
    paths.python,
    hermesArgs(["setup"], paths),
    { env: managedHermesEnv([], true) },
  );
}

/**
 * Copy the bundled runtime locally, seed the private home, then run
 * `hermes setup` under a PTY so its configuration wizard sees a real terminal.
 * There is no source clone or dependency download on the user's machine.
 */
async function startInstallHermesPty(): Promise<{ id: string; pid: number }> {
  const paths = await installBundledRuntime();
  await seedManagedHermesHome(paths);
  const pty = getPty();
  const id = randomUUID();
  const term = pty.spawn(paths.python, hermesArgs(["setup"], paths), {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: DEFAULT_WORKSPACE_ROOT,
    env: {
      ...managedHermesEnv([], true),
      // Restore TERM in case the parent Electron process had it unset
      // (macOS GUI launches strip it). install.sh + the python setup
      // wizard both branch on TERM for colour and curses behaviour.
      TERM: "xterm-256color",
    },
  });

  const job: PtyJob = {
    id,
    kind: "install-hermes-pty",
    pty: term,
    exited: false,
  };
  ptyJobs.set(id, job);

  term.onData((data) => {
    broadcast("hermes:pty-data", { jobId: id, data });
  });
  term.onExit(({ exitCode }) => {
    job.exited = true;
    broadcast("hermes:job-end", { jobId: id, exitCode });
    ptyJobs.delete(id);
  });

  return { id, pid: term.pid };
}

function ptyWrite(jobId: string, data: string): boolean {
  const job = ptyJobs.get(jobId);
  if (!job || job.exited) return false;
  try {
    job.pty.write(data);
  } catch {
    return false;
  }
  return true;
}

function ptyResize(jobId: string, cols: number, rows: number): boolean {
  const job = ptyJobs.get(jobId);
  if (!job || job.exited) return false;
  try {
    job.pty.resize(
      Math.max(1, Math.floor(cols)),
      Math.max(1, Math.floor(rows)),
    );
  } catch {
    return false;
  }
  return true;
}

function killPtyJob(jobId: string): boolean {
  const job = ptyJobs.get(jobId);
  if (!job) return false;
  try {
    job.pty.kill();
  } catch {
    return false;
  }
  return true;
}

function startInstallPlugin(_binary: string, pluginId: string) {
  const paths = managedHermesPaths();
  return startJob(
    "install-plugin",
    paths.python,
    hermesArgs(["plugins", "install", pluginId], paths),
  );
}

/**
 * Where the backplane Python source lives — it ships inside the app and gets
 * pip-installed into the hermes env (it's NOT a plugin). Packaged builds put it
 * under `resources/backend` (electron-builder extraResources); in dev it's the
 * monorepo's top-level `backend/`. `AMIBA_BACKPLANE_SOURCE` overrides both.
 */
function resolveBackplaneSource(): string {
  if (process.env.AMIBA_BACKPLANE_SOURCE)
    return process.env.AMIBA_BACKPLANE_SOURCE;
  const candidates = [
    path.join(process.resourcesPath, "backend"),
    path.resolve(app.getAppPath(), "..", "..", "backend"),
    path.resolve(app.getAppPath(), "..", "..", "..", "backend"),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "pyproject.toml"))) return c;
  }
  return candidates[0]; // best guess (packaged layout)
}

/**
 * The Python interpreter of the hermes env, so the backplane (which imports
 * hermes-agent) installs into the SAME env. Prefer the env python from the
 * `hermes` script's shebang; fall back to a `python` next to it, then PATH.
 */
async function resolveHermesPython(hermesBinary: string): Promise<string> {
  const managedPython = managedHermesPaths().python;
  if (samePath(hermesBinary, managedPython)) return managedPython;
  // Resolve both PATH names and installer-created symlinks. Hermes 0.19's
  // launcher has a /bin/sh polyglot shebang rather than a Python shebang, so
  // the reliable signal is the `python3` sibling of its canonical venv target.
  hermesBinary = await resolveExecutableTarget(hermesBinary, managedHermesEnv());
  try {
    const head = (await fs.readFile(hermesBinary, "utf8")).slice(0, 256);
    const m = /^#!\s*(\S*python\S*)/.exec(head);
    if (m && (await fileExists(m[1]))) return m[1];
  } catch {
    // not a text script (compiled binary), unreadable, etc. — fall through
  }
  if (path.isAbsolute(hermesBinary)) {
    const dir = path.dirname(hermesBinary);
    for (const name of IS_WIN ? ["python.exe"] : ["python3", "python"]) {
      const p = path.join(dir, name);
      if (await fileExists(p)) return p;
    }
  }
  return IS_WIN ? "python" : "python3";
}

function uvBinaryCandidates(): string[] {
  const hermesHome = managedHermesPaths().hermesHome;
  return IS_WIN
    ? [
        "uv.exe",
        path.join(hermesHome, "bin", "uv.exe"),
        path.join(USER_HOME, ".local", "bin", "uv.exe"),
        path.join(USER_HOME, ".cargo", "bin", "uv.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "uv", "uv.exe"),
      ]
    : [
        "uv",
        path.join(hermesHome, "bin", "uv"),
        path.join(USER_HOME, ".local", "bin", "uv"),
        path.join(USER_HOME, ".cargo", "bin", "uv"),
        "/opt/homebrew/bin/uv",
        "/usr/local/bin/uv",
      ];
}

/**
 * Find uv even when Electron was launched from Finder with a stripped PATH.
 * Hermes's supported installer uses uv and may deliberately create a venv
 * without pip, so uv is the primary package installer rather than a fallback.
 */
async function resolveUvBinary(): Promise<string | null> {
  const env = managedHermesEnv();
  for (const candidate of uvBinaryCandidates()) {
    if (path.isAbsolute(candidate)) {
      if (await fileExists(candidate)) return candidate;
      continue;
    }
    const resolved = await resolveOnPath(candidate, env);
    if (resolved) return resolved;
  }
  return null;
}

async function resolveBackplaneInstallCommand(
  hermesBinary: string,
): Promise<{ cmd: string; args: string[] }> {
  const python = await resolveHermesPython(hermesBinary);
  const source = resolveBackplaneSource();
  const sourceArgs = app.isPackaged ? [source] : ["--editable", source];
  const uv = await resolveUvBinary();
  if (uv) {
    return {
      cmd: uv,
      // Reinstall only Amiba's package. Omitting global `--upgrade` preserves
      // the dependency versions Hermes itself has pinned in this environment.
      args: [
        "pip",
        "install",
        "--python",
        python,
        "--reinstall-package",
        "amiba-backplane",
        ...sourceArgs,
      ],
    };
  }
  return {
    cmd: python,
    args: [
      "-m",
      "pip",
      "install",
      "--force-reinstall",
      "--no-deps",
      ...sourceArgs,
    ],
  };
}

async function readBackplaneSourceVersion(): Promise<string | null> {
  try {
    const pyproject = await fs.readFile(
      path.join(resolveBackplaneSource(), "pyproject.toml"),
      "utf8",
    );
    return /^\s*version\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function inspectInstalledBackplane(
  hermesBinary: string,
): Promise<{ modulePath: string; version: string } | null> {
  const python = await resolveHermesPython(hermesBinary);
  const script = [
    "from importlib.metadata import version",
    "from pathlib import Path",
    "import amiba_backplane",
    'print(version("amiba-backplane"))',
    "print(Path(amiba_backplane.__file__).resolve())",
  ].join("; ");
  const result = await runQuiet(
    python,
    ["-c", script],
    10_000,
    managedHermesEnv(),
  );
  if (result.code !== 0) return null;
  const [version, modulePath] = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return version && modulePath ? { modulePath, version } : null;
}

/**
 * Decide whether the copy imported by the Hermes interpreter represents this
 * app's bundled backend.
 *
 * Development uses an editable install: once the Hermes venv points at the
 * workspace, backend source edits are visible after the server restarts and do
 * not require a reinstall on every launch. Packaged builds compare package
 * versions, so an app update replaces an older backplane even when its console
 * script already exists.
 */
async function isBackplaneInstallCurrent(
  hermesBinary: string,
): Promise<boolean> {
  const installed = await inspectInstalledBackplane(hermesBinary);
  if (!installed) return false;

  if (!app.isPackaged) {
    const expectedPackageDir = path.resolve(
      resolveBackplaneSource(),
      "amiba_backplane",
    );
    const installedPackageDir = path.dirname(installed.modulePath);
    return installedPackageDir === expectedPackageDir;
  }

  const expectedVersion = await readBackplaneSourceVersion();
  return !!expectedVersion && installed.version === expectedVersion;
}

/**
 * Install the backplane server into the hermes Python env (creates the
 * `amiba-backplane` command that {@link startBackend} spawns). Idempotent —
 * uv is preferred because supported Hermes environments may not contain pip.
 */
async function startInstallBackplane(hermesBinary: string) {
  const { cmd, args } = await resolveBackplaneInstallCommand(hermesBinary);
  return startJob("install-backplane", cmd, args);
}

/**
 * The backplane server's launch command. The `amiba-backplane` console
 * script is pip-installed alongside the **env python** (the venv `bin/`), which
 * is NOT necessarily the dir holding the `hermes` launcher — `hermes` is
 * commonly a symlink in `~/.local/bin` pointing into a venv elsewhere. So we
 * resolve the script against the SAME env python the install used (via the
 * `hermes` shebang), not next to the launcher. If the env python can only be
 * PATH-resolved (relative name), rely on PATH for the script too.
 */
async function resolveBackplaneCmd(
  hermesBinary: string,
): Promise<{ cmd: string; args: string[] }> {
  const python = await resolveHermesPython(hermesBinary);
  return {
    cmd: python,
    args: [
      "-m",
      "amiba_backplane.runtime.server",
      "--port",
      String(MANAGED_HERMES_RUNTIME.backplanePort),
    ],
  };
}

/**
 * Start (and supervise) the backend: two long-running processes —
 *   - the **gateway** (`hermes gateway`): the agent that runs chat/LLM/tools;
 *   - the **backplane server** (`amiba-backplane`): the private HTTP front door
 *     that serves /hermes/* + /integrations/* and proxies /v1/* to the gateway.
 * Either order is fine — the backplane's /v1/* just 502s until the gateway is
 * up. The returned `id` is the backplane server's job (that's what the
 * onboarding wizard polls); `alreadyRunning` is true only if BOTH are
 * already up. Both procs' logs still stream via `hermes:job-log`.
 */
async function startBackend(binary: string) {
  const paths = managedHermesPaths();
  const gatewayUp = !!gatewayJob && !gatewayJob.child.killed;
  if (!gatewayUp) {
    // Amiba binds every task to a Hermes profile and routes named profiles
    // through `/p/<profile>/...`. The default profile must own the shared
    // listener, regardless of the user's sticky CLI profile.
    const multiplex = await runQuiet(
      paths.python,
      hermesArgs(
        ["-p", "default", "config", "set", "gateway.multiplex_profiles", "true"],
        paths,
      ),
      10_000,
      managedHermesEnv(),
    );
    if (multiplex.code !== 0) {
      throw new Error(
        `Could not enable Hermes profile routing: ${
          multiplex.stderr || multiplex.stdout || "unknown error"
        }`,
      );
    }
    startJob(
      "start-gateway",
      paths.python,
      hermesArgs(["-p", "default", "gateway"], paths),
    );
  }

  const backplaneUp = !!backplaneServerJob && !backplaneServerJob.child.killed;
  let backplane: { id: string; pid: number | undefined };
  if (backplaneUp) {
    backplane = {
      id: backplaneServerJob!.id,
      pid: backplaneServerJob!.child.pid,
    };
  } else {
    const { cmd, args } = await resolveBackplaneCmd(binary);
    backplane = startJob("start-backplane-server", cmd, args);
  }

  return {
    id: backplane.id,
    pid: backplane.pid,
    alreadyRunning: gatewayUp && backplaneUp,
  };
}

/**
 * Install the bundled backplane into the Hermes env, resolving on exit.
 * Awaitable, silent variant of {@link startInstallBackplane} (which streams as a
 * job) — used by {@link ensureBackend} so the renderer can `await` it without
 * juggling job-end events.
 */
async function installBackplane(binary: string): Promise<boolean> {
  const { cmd, args } = await resolveBackplaneInstallCommand(binary);
  const result = await runQuiet(cmd, args, 180_000, managedHermesEnv());
  if (result.code !== 0) {
    console.error(
      "[ensureBackend] backplane install failed:",
      `${result.stdout}\n${result.stderr}`.trim().slice(-1600),
    );
  }
  return result.code === 0;
}

type BackplaneProbe =
  | { state: "down" }
  | { state: "managed"; hermesHome: string }
  | { state: "foreign"; hermesHome?: string };

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Probe the private port and verify the responder owns Amiba's HERMES_HOME. */
function probeBackplane(timeoutMs = 1500): Promise<BackplaneProbe> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port: MANAGED_HERMES_RUNTIME.backplanePort,
        path: "/hermes/status",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (body.length < 64 * 1024) body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve({ state: "foreign" });
            return;
          }
          try {
            const data = JSON.parse(body) as { hermes_home?: unknown };
            const hermesHome =
              typeof data.hermes_home === "string" ? data.hermes_home : "";
            if (
              hermesHome &&
              samePath(hermesHome, managedHermesPaths().hermesHome)
            ) {
              resolve({ state: "managed", hermesHome });
            } else {
              resolve({
                state: "foreign",
                ...(hermesHome ? { hermesHome } : {}),
              });
            }
          } catch {
            resolve({ state: "foreign" });
          }
        });
      },
    );
    req.on("error", () => resolve({ state: "down" }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ state: "down" });
    });
  });
}

/** Poll the backplane health until it answers or we give up. */
async function pollBackplaneUp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeBackplane()).state === "managed") return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

/**
 * SILENT backend initialization — the "this is plumbing, not onboarding" path.
 *
 * Brings the private backplane up for an ALREADY-installed Hermes with no UI
 * beyond a plain loading state: verify the installed backplane belongs to this app build,
 * install/update it when necessary, then probe → spawn + supervise → wait for
 * it. Merely finding the console script is insufficient: that script can
 * point at an older Amiba package after the desktop source/app was updated.
 * Returns {ok}. The renderer runs this behind a spinner; it never shows a
 * wizard. (The hermes-install wizard stays separate, for machines with no
 * hermes at all.)
 */
async function ensureBackend(
  binary: string,
): Promise<{ ok: boolean; error?: string }> {
  const { cmd } = await resolveBackplaneCmd(binary);
  const haveScript = !path.isAbsolute(cmd) || (await fileExists(cmd));
  const installCurrent =
    haveScript && (await isBackplaneInstallCurrent(binary));
  if (!installCurrent) {
    const installed = await installBackplane(binary);
    if (!installed)
      return {
        ok: false,
        error: "backplane install failed (see main process log)",
      };
  }
  const initialProbe = await probeBackplane(1000);
  if (initialProbe.state === "managed") return { ok: true };
  if (initialProbe.state === "foreign") {
    return {
      ok: false,
      error:
        `port ${MANAGED_HERMES_RUNTIME.backplanePort} is already used by ` +
        (initialProbe.hermesHome
          ? `another Hermes home (${initialProbe.hermesHome})`
          : "another local service"),
    };
  }
  await startBackend(binary);
  const up = await pollBackplaneUp(60_000);
  return up
    ? { ok: true }
    : {
        ok: false,
        error: `backplane did not come up on :${MANAGED_HERMES_RUNTIME.backplanePort}`,
      };
}

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------

export function registerHermesRuntimeHandlers() {
  ipcMain.handle("hermes:detect", () => detectHermes());
  ipcMain.handle("hermes:install", () => startInstallHermes());
  ipcMain.handle("hermes:install-pty", () => startInstallHermesPty());
  ipcMain.handle(
    "hermes:install-plugin",
    (_e, args: { binary: string; pluginId: string }) =>
      startInstallPlugin(args.binary, args.pluginId),
  );
  ipcMain.handle("hermes:install-backplane", (_e, args: { binary: string }) =>
    startInstallBackplane(args.binary),
  );
  ipcMain.handle("hermes:start-backplane", (_e, args: { binary: string }) =>
    startBackend(args.binary),
  );
  ipcMain.handle("hermes:ensure-backend", (_e, args: { binary: string }) =>
    ensureBackend(args.binary),
  );
  ipcMain.handle("hermes:stop-backplane", () => {
    let any = false;
    if (gatewayJob) any = killJob(gatewayJob.id) || any;
    if (backplaneServerJob) any = killJob(backplaneServerJob.id) || any;
    return any;
  });
  ipcMain.handle(
    "hermes:cancel-job",
    (_e, jobId: string) =>
      // Look in both job tables — caller doesn't know whether the id
      // belongs to a pipe job or a PTY job.
      killJob(jobId) || killPtyJob(jobId),
  );
  ipcMain.handle(
    "hermes:pty-input",
    (_e, args: { jobId: string; data: string }) =>
      ptyWrite(args.jobId, args.data),
  );
  ipcMain.handle(
    "hermes:pty-resize",
    (_e, args: { jobId: string; cols: number; rows: number }) =>
      ptyResize(args.jobId, args.cols, args.rows),
  );
  ipcMain.handle("hermes:required-plugins", () => REQUIRED_PLUGINS);
  ipcMain.handle("hermes:installed-plugins", () =>
    listInstalledPlugins(REQUIRED_PLUGINS),
  );
  ipcMain.handle(
    "hermes:install-display-command",
    () => managedInstallDisplayCommand(),
  );
}

/** Kill every supervised job on app shutdown. */
export function stopAllHermesJobs() {
  for (const job of jobs.values()) {
    try {
      job.child.kill("SIGTERM");
    } catch {
      // best-effort — process may already be gone
    }
  }
  jobs.clear();
  gatewayJob = null;
  backplaneServerJob = null;
  for (const job of ptyJobs.values()) {
    try {
      job.pty.kill();
    } catch {
      // best-effort
    }
  }
  ptyJobs.clear();
}
