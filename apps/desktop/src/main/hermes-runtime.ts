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
 *   3. Supervise the long-running backplane process (`hermes gateway`).
 *      Only one supervised process at a time; killing it on app quit so
 *      the next launch isn't blocked by a stale 9394 listener.
 *
 * We deliberately do NOT try to be smart about plugin-list parsing here.
 * `hermes plugins install <id>` is idempotent on the hermes side, so
 * the wizard just re-runs both during onboarding without first checking
 * what's already installed. Simpler and safer.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { BrowserWindow, ipcMain } from "electron"

import type { IPty } from "node-pty"

/**
 * `node-pty` is a native module — loading it eagerly would crash the
 * main process if `electron-builder install-app-deps` hasn't rebuilt
 * the binding for this Electron version yet. Defer the require so the
 * failure surfaces only when the user actually triggers a PTY job, and
 * non-PTY paths (plugin install, backplane) keep working.
 */
let ptyMod: typeof import("node-pty") | null = null
function getPty(): typeof import("node-pty") {
  if (!ptyMod) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyMod = require("node-pty") as typeof import("node-pty")
  }
  return ptyMod
}

const HOME = os.homedir()
const IS_WIN = process.platform === "win32"

/**
 * Where to look for the `hermes` binary, in priority order.
 *   - `"hermes"` first so a sysadmin's symlink under `/usr/local/bin` wins
 *     when PATH actually contains it.
 *   - Then the well-known directories the install scripts target on each
 *     OS, in case PATH was stripped (Electron GUI launch on macOS).
 */
const HERMES_BINARY_CANDIDATES: string[] = IS_WIN
  ? [
      "hermes.exe",
      path.join(process.env.LOCALAPPDATA ?? "", "hermes", "bin", "hermes.exe"),
    ]
  : [
      "hermes",
      path.join(HOME, ".local", "bin", "hermes"),
      path.join(HOME, ".cargo", "bin", "hermes"),
      "/opt/homebrew/bin/hermes",
      "/usr/local/bin/hermes",
    ]

/**
 * Plugins the desktop shell depends on. The HTTP backplane exposes the
 * `/hermes/*` REST surface the renderer's `@hermes-x/core` client calls;
 * the browser-tools plugin handles the page-context features that the
 * extension also relies on. `hermes plugins install` errors out with
 * "already exists" when a plugin is present, so we probe the install
 * directory (`~/.hermes/plugins/<name>`) up-front and skip ones that are
 * already there.
 */
export const REQUIRED_PLUGINS: readonly string[] = [
  "iHeyTang/hermes-x-plugin-http-backplane",
  "iHeyTang/hermes-x-plugin-browser-tools",
]

/**
 * The on-disk directory name a plugin lives under — `~/.hermes/plugins/<name>`.
 * Strip the GitHub `user/` prefix; everything after the last `/` is the dir.
 */
function pluginDirName(pluginId: string): string {
  const slash = pluginId.lastIndexOf("/")
  return slash >= 0 ? pluginId.slice(slash + 1) : pluginId
}

/**
 * Best-effort: which of the required plugins are already on disk. Returns
 * the matching subset of `pluginIds`. Used so the wizard can skip already-
 * installed plugins instead of crashing on "already exists".
 */
export async function listInstalledPlugins(
  pluginIds: readonly string[],
): Promise<string[]> {
  const installed: string[] = []
  for (const id of pluginIds) {
    const dir = path.join(HOME, ".hermes", "plugins", pluginDirName(id))
    if (await fileExists(dir)) installed.push(id)
  }
  return installed
}

/**
 * Canonical install one-liners from the upstream README. We invoke them
 * via the platform's shell because the user's PATH and HOME need to be
 * the same as if they'd pasted into a terminal — that's what the install
 * scripts assume when they decide where to drop `~/.local/bin/hermes`,
 * `~/.bashrc`, etc.
 */
export const INSTALL_DISPLAY_COMMAND = IS_WIN
  ? 'iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)'
  : 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash'

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectionResult {
  installed: boolean
  /** Absolute path of the binary that responded to `--version`. */
  binary?: string
  /** Trimmed `hermes --version` output. */
  version?: string
}

interface QuickRunResult {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Spawn a short-lived process with a hard timeout, captured streams, and
 * no shell expansion. Used by the detection probe so a broken binary
 * (segfault, hang) doesn't wedge the wizard.
 */
async function runQuiet(
  cmd: string,
  args: string[],
  timeoutMs = 5000,
): Promise<QuickRunResult> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { shell: false })
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: String((err as Error).message) })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        // best-effort
      }
    }, timeoutMs)
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (d: string) => {
      stdout += d
    })
    child.stderr?.on("data", (d: string) => {
      stderr += d
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: stderr + String(err.message) })
    })
    child.on("exit", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function detectHermes(): Promise<DetectionResult> {
  for (const candidate of HERMES_BINARY_CANDIDATES) {
    // Absolute paths: short-circuit if the file isn't there so we don't
    // pay for a spawn just to see ENOENT.
    const isAbsolute = path.isAbsolute(candidate)
    if (isAbsolute && !(await fileExists(candidate))) continue

    const res = await runQuiet(candidate, ["--version"])
    if (res.code === 0) {
      const combined = `${res.stdout}${res.stderr}`.trim()
      return {
        installed: true,
        binary: candidate,
        version: combined || "(version unknown)",
      }
    }
  }
  return { installed: false }
}

// ---------------------------------------------------------------------------
// Job manager — long-running spawns that stream logs back to renderers
// ---------------------------------------------------------------------------

type JobKind = "install-hermes" | "install-plugin" | "start-backplane"

interface Job {
  id: string
  kind: JobKind
  child: ChildProcess
}

const jobs = new Map<string, Job>()
let backplaneJob: Job | null = null

/**
 * PTY-backed jobs run alongside the pipe-backed ones in a separate map.
 * Same job-end IPC contract, but output is streamed as raw byte chunks
 * over `hermes:pty-data` (no line splitting, ANSI preserved) so xterm.js
 * in the renderer can render the install.sh setup wizard as if it were
 * being run in a real terminal — which is the whole point of going PTY
 * here instead of pipes.
 */
interface PtyJob {
  id: string
  kind: "install-hermes-pty"
  pty: IPty
  exited: boolean
}

const ptyJobs = new Map<string, PtyJob>()

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}

interface SpawnOpts {
  cwd?: string
  /** Extra env vars merged on top of `process.env`. */
  env?: Record<string, string>
  /** Pass `true` to invoke the command through the platform's shell. */
  shell?: boolean | string
}

function startJob(
  kind: JobKind,
  cmd: string,
  args: string[],
  opts: SpawnOpts = {},
): { id: string; pid: number | undefined } {
  const id = randomUUID()
  const child = spawn(cmd, args, {
    shell: opts.shell ?? false,
    cwd: opts.cwd ?? HOME,
    env: {
      ...process.env,
      // Force-disable any "did you mean to use a TTY?" colourisation —
      // line-buffered streaming to the renderer reads cleaner without
      // ANSI sequences sprayed everywhere.
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...opts.env,
    },
    // The install scripts MUST NOT prompt for stdin (we have no TTY to
    // forward); attach /dev/null equivalent by ignoring stdin so any
    // read blocks immediately rather than hanging.
    stdio: ["ignore", "pipe", "pipe"],
  })

  const job: Job = { id, kind, child }
  jobs.set(id, job)
  if (kind === "start-backplane") backplaneJob = job

  let outBuf = ""
  let errBuf = ""
  // Accumulated lines, kept only so `finish()` can pattern-match the
  // output of an install-plugin job (the CLI errors with non-zero exit
  // when the plugin is already on disk — we treat that as success).
  let combinedOutput = ""

  function flushLines(stream: "stdout" | "stderr", buf: string): string {
    let rest = buf
    for (;;) {
      const nl = rest.indexOf("\n")
      if (nl < 0) break
      const line = rest.slice(0, nl).replace(/\r$/, "")
      rest = rest.slice(nl + 1)
      combinedOutput += line + "\n"
      broadcast("hermes:job-log", { jobId: id, stream, line })
    }
    return rest
  }

  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    outBuf = flushLines("stdout", outBuf + chunk)
  })
  child.stderr?.on("data", (chunk: string) => {
    errBuf = flushLines("stderr", errBuf + chunk)
  })

  function finish(code: number | null, error?: string) {
    // Flush whatever partial line is left so the renderer doesn't lose
    // the last "Done." line that lacked a trailing \n.
    if (outBuf) {
      combinedOutput += outBuf + "\n"
      broadcast("hermes:job-log", { jobId: id, stream: "stdout", line: outBuf })
    }
    if (errBuf) {
      combinedOutput += errBuf + "\n"
      broadcast("hermes:job-log", { jobId: id, stream: "stderr", line: errBuf })
    }
    outBuf = ""
    errBuf = ""
    let effectiveCode = code
    if (
      kind === "install-plugin" &&
      code !== 0 &&
      /plugin .* already exists/i.test(combinedOutput)
    ) {
      // Idempotent success: the plugin is already on disk. Report code 0
      // so the renderer marches on to the next plugin instead of erroring.
      effectiveCode = 0
    }
    broadcast("hermes:job-end", { jobId: id, exitCode: effectiveCode, error })
    jobs.delete(id)
    if (backplaneJob?.id === id) backplaneJob = null
  }

  child.on("error", (err) => finish(null, err.message))
  child.on("exit", (code) => finish(code))

  return { id, pid: child.pid }
}

function killJob(jobId: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
  const job = jobs.get(jobId)
  if (!job) return false
  try {
    job.child.kill(signal)
  } catch {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Specific spawn helpers
// ---------------------------------------------------------------------------

function startInstallHermes(): { id: string; pid: number | undefined } {
  if (IS_WIN) {
    return startJob(
      "install-hermes",
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)",
      ],
    )
  }
  return startJob("install-hermes", "bash", [
    "-c",
    "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash",
  ])
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
  const pty = getPty()
  const id = randomUUID()
  const cmd = IS_WIN ? "powershell.exe" : "/bin/bash"
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
      ]
  const term = pty.spawn(cmd, args, {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: HOME,
    env: {
      ...process.env,
      // Restore TERM in case the parent Electron process had it unset
      // (macOS GUI launches strip it). install.sh + the python setup
      // wizard both branch on TERM for colour and curses behaviour.
      TERM: "xterm-256color",
    },
  })

  const job: PtyJob = { id, kind: "install-hermes-pty", pty: term, exited: false }
  ptyJobs.set(id, job)

  term.onData((data) => {
    broadcast("hermes:pty-data", { jobId: id, data })
  })
  term.onExit(({ exitCode }) => {
    job.exited = true
    broadcast("hermes:job-end", { jobId: id, exitCode })
    ptyJobs.delete(id)
  })

  return { id, pid: term.pid }
}

function ptyWrite(jobId: string, data: string): boolean {
  const job = ptyJobs.get(jobId)
  if (!job || job.exited) return false
  try {
    job.pty.write(data)
  } catch {
    return false
  }
  return true
}

function ptyResize(jobId: string, cols: number, rows: number): boolean {
  const job = ptyJobs.get(jobId)
  if (!job || job.exited) return false
  try {
    job.pty.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)))
  } catch {
    return false
  }
  return true
}

function killPtyJob(jobId: string): boolean {
  const job = ptyJobs.get(jobId)
  if (!job) return false
  try {
    job.pty.kill()
  } catch {
    return false
  }
  return true
}

function startInstallPlugin(binary: string, pluginId: string) {
  return startJob("install-plugin", binary, ["plugins", "install", pluginId])
}

function startBackplane(binary: string) {
  if (backplaneJob && !backplaneJob.child.killed) {
    return { id: backplaneJob.id, pid: backplaneJob.child.pid, alreadyRunning: true }
  }
  // `hermes gateway` is the headless long-running entry — it boots the
  // plugin host (which in turn starts the HTTP backplane on 9394) without
  // claiming a TTY for an interactive chat REPL.
  const j = startJob("start-backplane", binary, ["gateway"])
  return { ...j, alreadyRunning: false }
}

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------

export function registerHermesRuntimeHandlers() {
  ipcMain.handle("hermes:detect", () => detectHermes())
  ipcMain.handle("hermes:install", () => startInstallHermes())
  ipcMain.handle("hermes:install-pty", () => startInstallHermesPty())
  ipcMain.handle(
    "hermes:install-plugin",
    (_e, args: { binary: string; pluginId: string }) =>
      startInstallPlugin(args.binary, args.pluginId),
  )
  ipcMain.handle("hermes:start-backplane", (_e, args: { binary: string }) =>
    startBackplane(args.binary),
  )
  ipcMain.handle("hermes:stop-backplane", () =>
    backplaneJob ? killJob(backplaneJob.id) : false,
  )
  ipcMain.handle("hermes:cancel-job", (_e, jobId: string) =>
    // Look in both job tables — caller doesn't know whether the id
    // belongs to a pipe job or a PTY job.
    killJob(jobId) || killPtyJob(jobId),
  )
  ipcMain.handle(
    "hermes:pty-input",
    (_e, args: { jobId: string; data: string }) => ptyWrite(args.jobId, args.data),
  )
  ipcMain.handle(
    "hermes:pty-resize",
    (_e, args: { jobId: string; cols: number; rows: number }) =>
      ptyResize(args.jobId, args.cols, args.rows),
  )
  ipcMain.handle("hermes:required-plugins", () => REQUIRED_PLUGINS)
  ipcMain.handle("hermes:installed-plugins", () => listInstalledPlugins(REQUIRED_PLUGINS))
  ipcMain.handle("hermes:install-display-command", () => INSTALL_DISPLAY_COMMAND)
}

/** Kill every supervised job on app shutdown. */
export function stopAllHermesJobs() {
  for (const job of jobs.values()) {
    try {
      job.child.kill("SIGTERM")
    } catch {
      // best-effort — process may already be gone
    }
  }
  jobs.clear()
  backplaneJob = null
  for (const job of ptyJobs.values()) {
    try {
      job.pty.kill()
    } catch {
      // best-effort
    }
  }
  ptyJobs.clear()
}
