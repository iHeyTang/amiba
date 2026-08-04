/**
 * Hermes-agent lifecycle plumbing for the onboarding wizard.
 *
 * Three responsibilities:
 *
 *   1. Detect whether `hermes` is already on the user's machine.
 *      Electron-launched GUI apps inherit a stripped PATH on macOS
 *      (`/usr/bin:/bin:/usr/sbin:/sbin`), so we can't rely on plain
 *      `which`. We probe both PATH (via the candidate name `"hermes"`)
 *      and the well-known directories the official install scripts
 *      drop binaries into.
 *
 *   2. Run install / plugin-install commands as background jobs and
 *      stream stdout/stderr back to the renderer line by line. The
 *      renderer never blocks waiting for completion — it subscribes to
 *      `hermes:job-log` + `hermes:job-end` and renders the tail live.
 *
 *   3. Supervise the two long-running backend processes: the gateway
 *      (`hermes gateway` — the agent that runs chat/LLM/tools) and the
 *      backplane server (`amiba-backplane` — the 9394 front door that
 *      serves /hermes/* + /integrations/* and proxies /v1/* to the gateway).
 *      Both killed on app quit so the next launch isn't blocked by a stale
 *      9394 listener. (The backplane used to be a plugin loaded *inside* the
 *      gateway; it's now its own process desktop spawns + supervises.)
 *
 * We deliberately do NOT try to be smart about plugin-list parsing here.
 * `hermes plugins install <id>` is idempotent on the hermes side, so
 * the wizard just re-runs both during onboarding without first checking
 * what's already installed. Simpler and safer.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import type { IPty } from "node-pty";
import {
  buildHermesRuntimeEnv,
  discoverHermes,
  fileExists,
  resolveExecutableTarget,
  resolveOnPath,
  runQuiet,
} from "./hermes-discovery";
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
const HERMES_HOME =
  process.env.HERMES_HOME && path.isAbsolute(process.env.HERMES_HOME)
    ? process.env.HERMES_HOME
    : path.join(USER_HOME, ".hermes");
const IS_WIN = process.platform === "win32";

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
    const dir = path.join(HERMES_HOME, "plugins", pluginDirName(id));
    if (await fileExists(dir)) installed.push(id);
  }
  return installed;
}

/**
 * Canonical install one-liners from the upstream README. We invoke them
 * via the platform's shell because the user's PATH and HOME need to be
 * the same as if they'd pasted into a terminal — that's what the install
 * scripts assume when they decide where to drop `~/.local/bin/hermes`,
 * `~/.bashrc`, etc.
 */
export const INSTALL_DISPLAY_COMMAND = IS_WIN
  ? "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)"
  : "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash";

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
  const result = await discoverHermes({
    cachedBinary: await readCachedHermesBinary(),
    env: process.env,
    userHome: USER_HOME,
  });
  if (result.installed && result.binary) {
    await writeCachedHermesBinary(result.binary);
  }
  return result;
}

const HERMES_RUNTIME_STATE_FILE = "hermes-runtime.json";

async function readCachedHermesBinary(): Promise<string | null> {
  try {
    const state = JSON.parse(
      await fs.readFile(
        path.join(app.getPath("userData"), HERMES_RUNTIME_STATE_FILE),
        "utf8",
      ),
    ) as { binary?: unknown };
    return typeof state.binary === "string" && path.isAbsolute(state.binary)
      ? state.binary
      : null;
  } catch {
    return null;
  }
}

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
      `${JSON.stringify({ version: 1, binary }, null, 2)}\n`,
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
  env?: Record<string, string>;
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
  const child = spawn(cmd, args, {
    shell: opts.shell ?? false,
    cwd: opts.cwd ?? DEFAULT_WORKSPACE_ROOT,
    env: buildHermesRuntimeEnv(
      {
        ...process.env,
        ...opts.env,
        // Force-disable any "did you mean to use a TTY?" colourisation —
        // line-buffered streaming to the renderer reads cleaner without
        // ANSI sequences sprayed everywhere.
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      USER_HOME,
      path.isAbsolute(cmd) ? [path.dirname(cmd)] : [],
    ),
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

function startInstallHermes(): { id: string; pid: number | undefined } {
  if (IS_WIN) {
    return startJob("install-hermes", "powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)",
    ]);
  }
  return startJob("install-hermes", "bash", [
    "-c",
    "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
  ]);
}

/**
 * Run the canonical install one-liner under a PTY so the embedded
 * `hermes setup` wizard sees a real terminal — without this the install
 * script's `(: </dev/tty)` probe fails and the wizard is silently
 * skipped, leaving the user with no API keys or messaging tokens
 * configured. Output streams to renderers as raw chunks over
 * `hermes:pty-data`; input from the renderer's xterm.js gets fed back
 * via {@link ptyWrite}.
 */
function startInstallHermesPty(): { id: string; pid: number } {
  const pty = getPty();
  const id = randomUUID();
  const cmd = IS_WIN ? "powershell.exe" : "/bin/bash";
  const args = IS_WIN
    ? [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)",
      ]
    : [
        "-lc",
        "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
      ];
  const term = pty.spawn(cmd, args, {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: DEFAULT_WORKSPACE_ROOT,
    env: {
      ...buildHermesRuntimeEnv(process.env, USER_HOME),
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

function startInstallPlugin(binary: string, pluginId: string) {
  return startJob("install-plugin", binary, ["plugins", "install", pluginId]);
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
  // Resolve both PATH names and installer-created symlinks. Hermes 0.19's
  // launcher has a /bin/sh polyglot shebang rather than a Python shebang, so
  // the reliable signal is the `python3` sibling of its canonical venv target.
  hermesBinary = await resolveExecutableTarget(hermesBinary);
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

const UV_BINARY_CANDIDATES: string[] = IS_WIN
  ? [
      "uv.exe",
      path.join(HERMES_HOME, "bin", "uv.exe"),
      path.join(USER_HOME, ".local", "bin", "uv.exe"),
      path.join(USER_HOME, ".cargo", "bin", "uv.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "uv", "uv.exe"),
    ]
  : [
      "uv",
      path.join(HERMES_HOME, "bin", "uv"),
      path.join(USER_HOME, ".local", "bin", "uv"),
      path.join(USER_HOME, ".cargo", "bin", "uv"),
      "/opt/homebrew/bin/uv",
      "/usr/local/bin/uv",
    ];

/**
 * Find uv even when Electron was launched from Finder with a stripped PATH.
 * Hermes's supported installer uses uv and may deliberately create a venv
 * without pip, so uv is the primary package installer rather than a fallback.
 */
async function resolveUvBinary(): Promise<string | null> {
  for (const candidate of UV_BINARY_CANDIDATES) {
    if (path.isAbsolute(candidate)) {
      if (await fileExists(candidate)) return candidate;
      continue;
    }
    const resolved = await resolveOnPath(candidate);
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
  const result = await runQuiet(python, ["-c", script], 10_000);
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
  const name = IS_WIN ? "amiba-backplane.exe" : "amiba-backplane";
  const python = await resolveHermesPython(hermesBinary);
  const cmd = path.isAbsolute(python)
    ? path.join(path.dirname(python), name)
    : name;
  return { cmd, args: ["--port", "9394"] };
}

/**
 * Start (and supervise) the backend: two long-running processes —
 *   - the **gateway** (`hermes gateway`): the agent that runs chat/LLM/tools;
 *   - the **backplane server** (`amiba-backplane`): the 9394 front door that
 *     serves /hermes/* + /integrations/* and proxies /v1/* to the gateway.
 * Either order is fine — the backplane's /v1/* just 502s until the gateway is
 * up. The returned `id` is the backplane server's job (that's what serves 9394,
 * which the onboarding wizard polls); `alreadyRunning` is true only if BOTH are
 * already up. Both procs' logs still stream via `hermes:job-log`.
 */
async function startBackend(binary: string) {
  const gatewayUp = !!gatewayJob && !gatewayJob.child.killed;
  if (!gatewayUp) {
    // Amiba binds every task to a Hermes profile and routes named profiles
    // through `/p/<profile>/...`. The default profile must own the shared
    // listener, regardless of the user's sticky CLI profile.
    const multiplex = await runQuiet(
      binary,
      ["-p", "default", "config", "set", "gateway.multiplex_profiles", "true"],
      10_000,
    );
    if (multiplex.code !== 0) {
      throw new Error(
        `Could not enable Hermes profile routing: ${
          multiplex.stderr || multiplex.stdout || "unknown error"
        }`,
      );
    }
    startJob("start-gateway", binary, ["-p", "default", "gateway"]);
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
  const result = await runQuiet(cmd, args, 180_000);
  if (result.code !== 0) {
    console.error(
      "[ensureBackend] backplane install failed:",
      `${result.stdout}\n${result.stderr}`.trim().slice(-1600),
    );
  }
  return result.code === 0;
}

/** One main-side health probe of the backplane on :9394. */
function probeBackplane(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port: 9394,
        path: "/hermes/status",
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Poll the backplane health until it answers or we give up. */
async function pollBackplaneUp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeBackplane()) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

/**
 * SILENT backend initialization — the "this is plumbing, not onboarding" path.
 *
 * Brings :9394 up for an ALREADY-installed hermes with no UI beyond a plain
 * loading state: verify the installed backplane belongs to this app build,
 * install/update it when necessary, then probe → spawn + supervise → wait for
 * :9394. Merely finding the console script is insufficient: that script can
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
  if (await probeBackplane(1000)) return { ok: true };
  await startBackend(binary);
  const up = await pollBackplaneUp(60_000);
  return up
    ? { ok: true }
    : { ok: false, error: "backplane did not come up on :9394" };
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
    () => INSTALL_DISPLAY_COMMAND,
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
