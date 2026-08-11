/**
 * Hermes-agent lifecycle plumbing for Amiba Desktop.
 *
 * Three responsibilities:
 *
 *   1. Detect Amiba's pinned, app-owned Hermes runtime. A system `hermes`
 *      is deliberately ignored so Amiba never mutates another installation.
 *
 *   2. Supervise the two long-running backend processes: the gateway
 *      (`hermes gateway` — the agent that runs chat/LLM/tools) and the
 *      backplane server (`amiba-backplane` — the app-private HTTP front door
 *      that serves /hermes/* + /integrations/* and proxies /v1/* to the gateway).
 *      Both killed on app quit so the next launch isn't blocked by a stale
 *      listener. (The backplane used to be a plugin loaded *inside* the
 *      gateway; it's now its own process desktop spawns + supervises.)
 *
 * Runtime installation happens only during Amiba's build. End-user startup
 * never downloads source, installs packages, or exposes an install wizard.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { app, ipcMain } from "electron";
import {
  buildHermesRuntimeEnv,
  fileExists,
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

const USER_HOME = os.homedir();
const DEFAULT_WORKSPACE_ROOT = getDefaultWorkspaceRoot();
const IS_WIN = process.platform === "win32";
// The gateway API is private to this Electron process. Both supervised
// children receive the same ephemeral key, so Backplane can authenticate to
// Hermes without persisting another user-managed secret.
const MANAGED_GATEWAY_API_KEY = randomBytes(32).toString("hex");

function managedHermesPaths(): ManagedHermesPaths {
  const override = process.env.AMIBA_HERMES_USER_DATA_DIR;
  const userDataDir =
    override && path.isAbsolute(override) ? override : app.getPath("userData");
  return resolveManagedHermesPaths(
    userDataDir,
    bundledRuntimeDir(),
    process.platform,
  );
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

function hermesArgs(
  args: readonly string[],
  paths = managedHermesPaths(),
): string[] {
  return [managedHermesEntrypoint(paths), ...args];
}

function managedHermesEnv(
  extraPathEntries: readonly string[] = [],
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
  const backplaneSource = resolveBackplaneDevelopmentSource();
  const pythonPath = [sourceDir, backplaneSource, process.env.PYTHONPATH]
    .filter((value): value is string => !!value)
    .join(path.delimiter);
  const source = buildManagedHermesEnvironment(
    { ...process.env, API_SERVER_KEY: MANAGED_GATEWAY_API_KEY },
    paths,
  );
  source.HERMES_INSTALL_DIR = sourceDir;
  source.PYTHONPATH = pythonPath;
  return buildHermesRuntimeEnv(source, USER_HOME, [
    paths.nodeBinDir,
    bundledNodeModulesBin,
    path.dirname(paths.binary),
    ...extraPathEntries,
  ]);
}

function bundleMarkerMatches(marker: BundledHermesRuntimeMarker): boolean {
  const expected = expectedBundledHermesRuntimeMarker(
    process.platform,
    process.arch,
  );
  return (Object.keys(expected) as (keyof BundledHermesRuntimeMarker)[]).every(
    (key) => marker[key] === expected[key],
  );
}

async function readBundleMarker(
  directory: string,
): Promise<BundledHermesRuntimeMarker | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(directory, "runtime-manifest.json"), "utf8"),
    ) as BundledHermesRuntimeMarker;
  } catch {
    return null;
  }
}

async function runtimeFilesReady(
  paths = managedHermesPaths(),
): Promise<boolean> {
  const marker = await readBundleMarker(paths.runtimeDir);
  if (!marker || !bundleMarkerMatches(marker)) return false;
  if (
    typeof marker.backplaneVersion !== "string" ||
    marker.backplaneVersion.length === 0 ||
    !/^[0-9a-f]{64}$/.test(marker.backplaneSourceHash ?? "")
  ) {
    return false;
  }
  const node = path.join(paths.nodeBinDir, IS_WIN ? "node.exe" : "node");
  return (
    (await fileExists(paths.python)) &&
    (await fileExists(paths.entrypoint)) &&
    (await fileExists(node))
  );
}

/**
 * Validate and return the immutable Runtime shipped with the application.
 * Runtime code and dependencies execute directly from application resources;
 * only HERMES_HOME lives under writable user data.
 */
async function requireBundledRuntime(): Promise<ManagedHermesPaths> {
  const paths = managedHermesPaths();
  const marker = await readBundleMarker(paths.runtimeDir);
  if (!marker) {
    throw new Error(
      `Hermes Runtime is missing at ${paths.runtimeDir}. Run pnpm runtime:prepare from the repository root.`,
    );
  }
  if (!bundleMarkerMatches(marker)) {
    throw new Error(
      `Hermes Runtime targets ${marker.platform}-${marker.arch} / ${marker.hermesCommit}; ` +
        `this app requires ${process.platform}-${process.arch} / ${MANAGED_HERMES_RUNTIME.commit}.`,
    );
  }
  if (!(await runtimeFilesReady(paths))) {
    throw new Error(
      `Hermes Runtime is incomplete or stale at ${paths.runtimeDir}. Run pnpm runtime:prepare from the repository root.`,
    );
  }
  return paths;
}

async function copyIfMissing(
  source: string,
  destination: string,
): Promise<void> {
  if (await fileExists(destination)) return;
  if (!(await fileExists(source))) return;
  await fs
    .copyFile(source, destination, fsConstants.COPYFILE_EXCL)
    .catch((error: NodeJS.ErrnoException) => {
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
    homeDirs.map((name) =>
      fs.mkdir(path.join(paths.hermesHome, name), { recursive: true }),
    ),
  );
  const source = managedHermesSourceDir(paths);
  await copyIfMissing(
    path.join(source, ".env.example"),
    path.join(paths.hermesHome, ".env"),
  );
  await copyIfMissing(
    path.join(source, "cli-config.yaml.example"),
    path.join(paths.hermesHome, "config.yaml"),
  );
  if (!IS_WIN)
    await fs.chmod(path.join(paths.hermesHome, ".env"), 0o600).catch(() => {});

  const skillsSync = path.join(source, "tools", "skills_sync.py");
  if (await fileExists(skillsSync)) {
    const result = await runQuiet(
      paths.python,
      [skillsSync],
      60_000,
      managedHermesEnv(),
    );
    if (result.code !== 0) {
      console.warn(
        "[hermes:runtime] bundled skills sync failed:",
        result.stderr || result.stdout,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Supervised built-in services
// ---------------------------------------------------------------------------

type JobKind = "start-gateway" | "start-backplane-server";

interface Job {
  id: string;
  kind: JobKind;
  child: ChildProcess;
}

const jobs = new Map<string, Job>();
// Keep each service in its own slot so startup remains idempotent and app quit
// can stop both children.
let gatewayJob: Job | null = null;
let backplaneServerJob: Job | null = null;

function startJob(kind: JobKind, cmd: string, args: string[]): Job {
  const id = randomUUID();
  const runtimeEnv = managedHermesEnv(
    path.isAbsolute(cmd) ? [path.dirname(cmd)] : [],
  );
  const child = spawn(cmd, args, {
    shell: false,
    cwd: DEFAULT_WORKSPACE_ROOT,
    env: {
      ...runtimeEnv,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const job: Job = { id, kind, child };
  jobs.set(id, job);
  if (kind === "start-gateway") gatewayJob = job;
  else if (kind === "start-backplane-server") backplaneServerJob = job;

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    const message = chunk.trimEnd();
    if (message) console.info(`[hermes:${kind}] ${message}`);
  });
  child.stderr?.on("data", (chunk: string) => {
    const message = chunk.trimEnd();
    if (message) console.warn(`[hermes:${kind}] ${message}`);
  });

  function finish(code: number | null, error?: string) {
    jobs.delete(id);
    if (gatewayJob?.id === id) gatewayJob = null;
    if (backplaneServerJob?.id === id) backplaneServerJob = null;
    if (error || (code !== null && code !== 0)) {
      console.error(
        `[hermes:${kind}] exited${code === null ? "" : ` with code ${code}`}`,
        error ?? "",
      );
    }
  }

  child.on("error", (err) => finish(null, err.message));
  child.on("exit", (code) => finish(code));

  return job;
}

// ---------------------------------------------------------------------------
// Backplane source and validation
// ---------------------------------------------------------------------------

/** Development may explicitly import Backplane from a source checkout.
 * The default development path and all packaged builds import the immutable
 * copy installed into the bundled Python Runtime by `runtime:prepare`.
 */
function resolveBackplaneDevelopmentSource(): string | undefined {
  if (app.isPackaged) return undefined;
  const configured = process.env.AMIBA_BACKPLANE_SOURCE;
  if (!configured) return undefined;
  const override = path.resolve(configured);
  return existsSync(path.join(override, "pyproject.toml"))
    ? override
    : undefined;
}

async function inspectInstalledBackplane(): Promise<{
  modulePath: string;
  version: string;
} | null> {
  const python = managedHermesPaths().python;
  const script = [
    "from importlib.metadata import version",
    "from pathlib import Path",
    "import amiba_backplane",
    'print(version("amiba-backplane"))',
    "print(Path(amiba_backplane.__file__).resolve())",
  ].join("; ");
  const result = await runQuiet(
    python,
    ["-I", "-c", script],
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

/** Verify that Backplane is already part of the immutable bundled Runtime. */
async function bundledBackplaneReady(): Promise<boolean> {
  const installed = await inspectInstalledBackplane();
  if (!installed) return false;
  const relative = path.relative(
    managedHermesPaths().runtimeDir,
    installed.modulePath,
  );
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Backplane is built into the same immutable Python Runtime as Hermes. */
function resolveBackplaneCmd(): { cmd: string; args: string[] } {
  const python = managedHermesPaths().python;
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
 * up. Electron owns both children for the lifetime of the app.
 */
async function startGateway(): Promise<void> {
  const paths = managedHermesPaths();
  const gatewayUp = !!gatewayJob && !gatewayJob.child.killed;
  if (!gatewayUp) {
    // Amiba binds every task to a Hermes profile and routes named profiles
    // through `/p/<profile>/...`. The default profile must own the shared
    // listener, regardless of the user's sticky CLI profile.
    const multiplex = await runQuiet(
      paths.python,
      hermesArgs(
        [
          "-p",
          "default",
          "config",
          "set",
          "gateway.multiplex_profiles",
          "true",
        ],
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
      // Amiba owns both this private HERMES_HOME and the child process
      // lifecycle. A separately installed Hermes launchd/systemd service may
      // still exist for the user's normal home; bypass that unrelated service
      // guard and keep this isolated gateway in the foreground under Electron.
      hermesArgs(["-p", "default", "gateway", "run", "--force"], paths),
    );
  }
}

async function startBackend(): Promise<void> {
  await startGateway();

  const backplaneUp = !!backplaneServerJob && !backplaneServerJob.child.killed;
  if (!backplaneUp) {
    const { cmd, args } = resolveBackplaneCmd();
    startJob("start-backplane-server", cmd, args);
  }
}

type BackplaneProbe =
  | { state: "down" }
  | { state: "managed"; hermesHome: string; gatewayRunning: boolean }
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
            const data = JSON.parse(body) as {
              gateway_running?: unknown;
              hermes_home?: unknown;
            };
            const hermesHome =
              typeof data.hermes_home === "string" ? data.hermes_home : "";
            if (
              hermesHome &&
              samePath(hermesHome, managedHermesPaths().hermesHome)
            ) {
              resolve({
                state: "managed",
                hermesHome,
                gatewayRunning: data.gateway_running === true,
              });
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

/** Verify the gateway's HTTP listener, not merely its process-id file. */
function probeGateway(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port: MANAGED_HERMES_RUNTIME.gatewayPort,
        path: "/health",
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

/** Poll until both the private Backplane and the Hermes Gateway are ready. */
async function pollManagedServicesUp(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [backplane, gatewayListening] = await Promise.all([
      probeBackplane(),
      probeGateway(),
    ]);
    if (
      backplane.state === "managed" &&
      backplane.gatewayRunning &&
      gatewayListening
    ) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

/**
 * Validate the immutable Runtime, seed only its writable HERMES_HOME, then
 * probe, spawn, supervise, and wait for the local services. Startup never
 * mutates the bundled Python environment.
 */
async function ensureBackend(): Promise<{ ok: boolean; error?: string }> {
  let paths: ManagedHermesPaths;
  try {
    paths = await requireBundledRuntime();
    await seedManagedHermesHome(paths);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!(await bundledBackplaneReady())) {
    return {
      ok: false,
      error:
        "the built-in Runtime does not contain Backplane; rebuild or reinstall Amiba",
    };
  }
  const initialProbe = await probeBackplane(1000);
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
  if (initialProbe.state === "managed") {
    if (initialProbe.gatewayRunning && (await probeGateway())) {
      return { ok: true };
    }
    await startGateway();
  } else {
    await startBackend();
  }
  const up = await pollManagedServicesUp(60_000);
  return up
    ? { ok: true }
    : {
        ok: false,
        error:
          `the built-in Hermes services did not become ready on ` +
          `:${MANAGED_HERMES_RUNTIME.backplanePort}`,
      };
}

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------

export function registerHermesRuntimeHandlers() {
  ipcMain.handle("hermes:ensure-backend", () => ensureBackend());
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
}
